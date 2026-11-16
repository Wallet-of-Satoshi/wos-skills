// Turns what Spark returns for balances and history into the plain rows the skill prints. Nothing here talks to
// the network, which is what lets it be tested without a wallet.

const hexOf = (bytes) => (bytes ? Buffer.from(bytes).toString('hex') : '');
const bigIntOf = (bytes) => (bytes?.length ? BigInt(`0x${hexOf(bytes)}`) : 0n);
const isoTime = (value) => (value instanceof Date ? value.toISOString() : String(value || ''));

// ---- Sats

// Spark's TransferType and TransferStatus, by number. Anything not listed is 'other' or still 'pending'.
const TRANSFER_KINDS = {0: 'lightning', 1: 'onchain_withdrawal', 2: 'spark', 3: 'onchain_deposit'};
const TRANSFER_STATES = {5: 'completed', 6: 'expired', 7: 'returned'};

/**
 * One row of history from a Spark transfer. A viewer key is shown the movement of funds and not the invoice
 * behind it, so there is no description, payee or preimage to give.
 */
export function describeTransfer(transfer, walletPubKey) {
  return {
    id: transfer.id,
    time: isoTime(transfer.createdTime),
    direction: hexOf(transfer.senderIdentityPublicKey) === walletPubKey ? 'out' : 'in',
    amount_sats: Number(transfer.totalValue),
    kind: TRANSFER_KINDS[transfer.type] || 'other',
    status: TRANSFER_STATES[transfer.status] || 'pending',
  };
}

// ---- Tokens (USDB and any other Spark token)

// Spark's TokenTransactionStatus, by number: 2 is finalized, 3 and 4 are cancelled.
const TOKEN_STATES = {2: 'completed', 3: 'failed', 4: 'failed'};

/** A token amount in whole units, as text so that no precision is lost: 250000 at 6 decimals is "0.25". */
export function formatUnits(baseUnits, decimals) {
  const digits = BigInt(baseUnits).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The wallet's token balances, from the SDK's map of token id to balance. */
export function describeTokenBalances(balances) {
  return [...balances].map(([tokenId, {ownedBalance, tokenMetadata}]) => ({
    currency: tokenMetadata?.tokenTicker || tokenId,
    name: tokenMetadata?.tokenName,
    amount: formatUnits(ownedBalance ?? 0n, tokenMetadata?.decimals ?? 0),
    token_id: tokenId,
  }));
}

/** Ticker and decimals for each token the wallet holds, keyed by the raw id that transaction outputs carry. */
export function tokensByRawId(balances) {
  const tokens = new Map();
  for (const {tokenMetadata} of balances.values()) {
    if (tokenMetadata?.rawTokenIdentifier) {
      tokens.set(hexOf(tokenMetadata.rawTokenIdentifier), {currency: tokenMetadata.tokenTicker, decimals: tokenMetadata.decimals});
    }
  }
  return tokens;
}

/**
 * The newest token payments as rows, from the wallet owner's side.
 *
 * A token transaction names the owner of each output it creates, but not of the outputs it spends: for those it
 * gives only the earlier transaction and position. So whether the wallet sent a payment is answered by finding
 * those earlier outputs. `transactions` must therefore be everything fetched so far, not only what will be
 * shown.
 *
 * If an earlier transaction is not among them, the wallet may or may not have owned what was spent. Once the
 * wallet's whole history has been fetched (`wholeHistory`) it certainly did not, and the payment is incoming.
 * Until then its direction is 'unknown'.
 */
export function describeTokenTransactions(transactions, walletPubKey, tokens, limit, wholeHistory) {
  const byHash = new Map(transactions.map(tx => [hexOf(tx.tokenTransactionHash), tx]));
  const timeOf = (tx) => isoTime(tx.tokenTransaction?.clientCreatedTimestamp);
  const isMine = (output) => hexOf(output?.ownerPublicKey) === walletPubKey;
  const outputSpentBy = (input) =>
    byHash.get(hexOf(input.prevTokenTransactionHash))?.tokenTransaction?.tokenOutputs?.[input.prevTokenTransactionVout];

  const describe = (tx) => {
    const outputs = tx.tokenTransaction?.tokenOutputs || [];
    const mine = outputs.filter(isMine);
    const others = outputs.filter(output => !isMine(output));
    const spent = (tx.tokenTransaction?.tokenInputs?.transferInput?.outputsToSpend || []).map(outputSpentBy);

    let direction;
    if (spent.some(isMine)) {
      direction = others.length ? 'out' : 'self'; // 'self': the wallet rearranging its own funds
    } else if (!mine.length) {
      direction = 'out'; // Nothing came to the wallet, so it can only be here as the sender
    } else {
      direction = wholeHistory || spent.every(Boolean) ? 'in' : 'unknown';
    }

    // Outgoing: what went to others, leaving out the change that came back. Otherwise: what came to the wallet.
    const counted = direction === 'out' ? others : mine;
    const baseUnits = counted.reduce((sum, output) => sum + bigIntOf(output.tokenAmount), 0n);
    const token = tokens.get(hexOf(counted[0]?.tokenIdentifier));
    return {
      id: hexOf(tx.tokenTransactionHash),
      time: timeOf(tx),
      direction,
      // A token the wallet no longer holds has no known decimals, so its amount is given in base units instead
      amount: token ? formatUnits(baseUnits, token.decimals) : undefined,
      amount_base_units: token ? undefined : String(baseUnits),
      currency: token?.currency || 'token',
      kind: 'token',
      status: TOKEN_STATES[tx.status] || 'pending',
    };
  };

  return [...byHash.values()]
    .sort((a, b) => timeOf(b).localeCompare(timeOf(a)))
    .slice(0, limit)
    .map(describe);
}

/** Sats and token rows together, newest first. */
export function mergeHistory(satsRows, tokenRows, limit) {
  return [...satsRows, ...tokenRows].sort((a, b) => b.time.localeCompare(a.time)).slice(0, limit);
}
