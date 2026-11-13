// Everything that talks to Spark: reading the wallet with its viewer key, and making invoices that pay it.
// Wallet of Satoshi's servers are not involved in any of this, and hold no key that could do it.

import { WosBotError } from './errors.mjs';
import { describeTokenBalances, describeTokenTransactions, describeTransfer, mergeHistory, tokensByRawId } from './history.mjs';
import { invoiceAmountMsat } from './lightning.mjs';
import { describeReceive, invoiceOptions } from './receive.mjs';

const NETWORK = 'MAINNET';
const TOKEN_PAGE_SIZE = 100;
const TOKEN_MAX_PAGES = 30; // How far back token history is read to work out which way a payment went

/**
 * The Spark SDK, and the 12-word phrase the viewer key stands for. Imported here rather than at the top so the
 * commands that never touch Spark start quickly.
 */
async function loadSpark(connection) {
  const [{entropyToMnemonic}, {wordlist}, sdk] = await Promise.all([
    import('@scure/bip39'),
    import('@scure/bip39/wordlists/english'),
    import('@buildonspark/spark-sdk'),
  ]);
  return {sdk, mnemonic: entropyToMnemonic(connection.viewerEntropy, wordlist)};
}

/** A read-only client for the owner's wallet, and the wallet's Spark address. */
async function openViewer(connection) {
  const {sdk, mnemonic} = await loadSpark(connection);
  const client = await sdk.SparkReadonlyClient.createWithViewerKey({network: NETWORK}, mnemonic);
  const address = sdk.encodeSparkAddress({identityPublicKey: connection.walletPubKey, network: NETWORK});
  return {sdk, client, address};
}

/**
 * Runs `task` with a Spark wallet started on the viewer phrase. That wallet is the agent's own identity on
 * Spark: it holds no funds and is not the owner's wallet. It exists so the agent has something to ask Spark
 * with when it needs more than a read.
 */
async function withAgentWallet(connection, task) {
  const {sdk, mnemonic} = await loadSpark(connection);
  let wallet;
  try {
    ({wallet} = await sdk.SparkWallet.initialize({mnemonicOrSeed: mnemonic, options: {network: NETWORK}}));
    return await task(wallet, sdk);
  } finally {
    await wallet?.cleanupConnections?.().catch(() => {});
  }
}

/** Passes on the outcomes the skill names, and reports anything else from Spark as one plain refusal. */
function sparkFailure(error, code, message) {
  return error instanceof WosBotError ? error : new WosBotError(code, message);
}

/** The wallet's sats and token balances. `empty` says Spark showed nothing at all, which the caller must check. */
export async function readBalance(connection) {
  try {
    const {client, address} = await openViewer(connection);
    const [available, owned, tokens] = await Promise.all([
      client.getAvailableBalance(address), client.getOwnedBalance(address), client.getTokenBalance(address),
    ]);
    return {
      balance: {available_sats: Number(available), owned_sats: Number(owned), tokens: describeTokenBalances(tokens)},
      empty: available === 0n && owned === 0n && tokens.size === 0,
    };
  } catch (error) {
    throw sparkFailure(error, 'SPARK_UNREACHABLE', 'Could not read the wallet from Spark. Try again shortly.');
  }
}

/**
 * The newest token payments. Spark returns token history a page at a time, newest page first. Earlier pages
 * are fetched only while a payment to be shown cannot yet be called incoming or outgoing, which in practice
 * means the whole history: two requests for a wallet with 200 token payments.
 */
async function readTokenHistory(client, address, walletPubKey, tokens, limit) {
  let transactions = [];
  let rows = [];
  let cursor;
  for (let page = 0; page < TOKEN_MAX_PAGES; page++) {
    const result = await client.getTokenTransactions({
      sparkAddresses: [address], pageSize: TOKEN_PAGE_SIZE, direction: 'PREVIOUS', ...(cursor ? {cursor} : {}),
    });
    const fetched = result.transactions || [];
    transactions = transactions.concat(fetched);

    const earlier = result.pageResponse?.hasPreviousPage ? result.pageResponse.previousCursor : undefined;
    const wholeHistory = !earlier || earlier === cursor || fetched.length === 0;
    rows = describeTokenTransactions(transactions, walletPubKey, tokens, limit, wholeHistory);
    if (wholeHistory || rows.every(row => row.direction !== 'unknown')) {
      break;
    }
    cursor = earlier;
  }
  return rows;
}

/**
 * The newest payments in and out, sats and tokens together, newest first. `empty` says Spark showed nothing
 * that needs the viewer key, which the caller must check: token payments alone prove nothing, because Spark
 * shows those to anyone.
 */
export async function readHistory(connection, limit) {
  try {
    const {client, address} = await openViewer(connection);
    const [page, tokens] = await Promise.all([
      client.getTransfers({sparkAddress: address, limit}), client.getTokenBalance(address),
    ]);
    const satsRows = page.transfers.map(transfer => describeTransfer(transfer, connection.walletPubKey));
    const tokenRows = await readTokenHistory(client, address, connection.walletPubKey, tokensByRawId(tokens), limit);
    return {transfers: mergeHistory(satsRows, tokenRows, limit), empty: satsRows.length === 0 && tokens.size === 0};
  } catch (error) {
    throw sparkFailure(error, 'SPARK_UNREACHABLE', 'Could not read the wallet from Spark. Try again shortly.');
  }
}

/**
 * A Lightning invoice that pays the owner's wallet. Spark lets one wallet ask for an invoice on another's
 * behalf, given only its public key, so the agent's own wallet asks and the owner's wallet is the receiver.
 * Nothing paid to the invoice can come to the agent.
 */
export async function createInvoice(connection, sats, memo, lightningOnly) {
  try {
    return await withAgentWallet(connection, async (wallet) => {
      const request = await wallet.createLightningInvoice(invoiceOptions(connection.walletPubKey, sats, memo, lightningOnly));
      const invoice = request?.invoice?.encodedInvoice;
      if (typeof invoice !== 'string' || invoiceAmountMsat(invoice) !== BigInt(sats) * 1000n) {
        throw new Error('Spark did not return an invoice for the amount asked');
      }
      return {
        invoice,
        amount_sats: sats,
        memo: memo || undefined,
        expires_at: request.invoice.expiresAt,
        request_id: request.id,
        spark_invoice: request.sparkInvoice || undefined,
      };
    });
  } catch (error) {
    throw sparkFailure(error, 'INVOICE_NOT_CREATED', 'Spark could not create the invoice. Try again shortly.');
  }
}

/** The status of the Spark invoice inside a Lightning invoice, having checked it really is for this wallet. */
async function sparkInvoiceStatus(connection, sparkInvoice) {
  const {sdk, client} = await openViewer(connection);
  let decoded;
  try {
    decoded = sdk.decodeSparkAddress(sparkInvoice, NETWORK);
  } catch {
    decoded = null;
  }
  if (decoded?.identityPublicKey !== connection.walletPubKey || !decoded.sparkInvoiceFields) {
    throw new WosBotError('INVALID_SPARK_INVOICE', 'Give the spark_invoice the invoice command returned');
  }
  const found = (await client.getSparkInvoices({invoices: [sparkInvoice]})).invoiceStatuses[0];
  const paidBy = found?.transferType?.$case === 'satsTransfer' ? found.transferType.satsTransfer.transferId : undefined;
  return {status: found?.status, transferId: paidBy};
}

/**
 * Whether an invoice from createInvoice has been paid. `sparkInvoice` is left out for an invoice made with
 * lightningOnly, which has no Spark invoice inside it.
 */
export async function invoiceStatus(connection, requestId, sparkInvoice) {
  if (!/^SparkLightningReceiveRequest:[0-9a-f-]{36}$/.test(String(requestId || ''))) {
    throw new WosBotError('INVALID_REQUEST_ID', 'Give the request_id the invoice command returned');
  }
  try {
    const spark = sparkInvoice ? await sparkInvoiceStatus(connection, sparkInvoice) : undefined;
    const request = await withAgentWallet(connection, wallet => wallet.getLightningReceiveRequest(requestId));
    if (!request) {
      throw new WosBotError('INVOICE_NOT_FOUND', 'No invoice with that request_id was created with this connection');
    }
    return describeReceive(request, spark, Date.now());
  } catch (error) {
    throw sparkFailure(error, 'SPARK_UNREACHABLE', 'Could not ask Spark about the invoice. Try again shortly.');
  }
}
