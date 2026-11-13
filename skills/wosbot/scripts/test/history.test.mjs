import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeTokenBalances, describeTokenTransactions, describeTransfer, formatUnits, mergeHistory, tokensByRawId,
} from '../src/history.mjs';
import { OTHER_WALLET, WALLET } from './fixtures.mjs';

// ---- Builders for made-up Spark records

const USDB_RAW_ID = Buffer.from('aa'.repeat(32), 'hex');
const USDB = new Map([['aa'.repeat(32), {currency: 'USDB', decimals: 6}]]);

/** A 32-byte transaction hash made of one repeated digit, so tests can refer to transactions by number. */
const hash = (n) => Buffer.from(String(n).repeat(64), 'hex');

const output = (owner, baseUnits) => ({
  ownerPublicKey: Buffer.from(owner, 'hex'),
  tokenIdentifier: USDB_RAW_ID,
  tokenAmount: Buffer.from(BigInt(baseUnits).toString(16).padStart(32, '0'), 'hex'),
});

/** A token transaction. `spends` lists [transaction number, output position] pairs, or is null for a mint. */
const tokenTx = (n, time, spends, outputs, status = 2) => ({
  tokenTransactionHash: hash(n),
  status,
  tokenTransaction: {
    clientCreatedTimestamp: new Date(time),
    tokenOutputs: outputs,
    tokenInputs: spends
      ? {$case: 'transferInput', transferInput: {outputsToSpend: spends.map(([prev, vout]) => ({prevTokenTransactionHash: hash(prev), prevTokenTransactionVout: vout}))}}
      : {$case: 'mintInput', mintInput: {}},
  },
});

// ---- Sats

test('a transfer is described from the wallet owner\'s side', () => {
  const sent = describeTransfer({
    id: 'transfer-1', createdTime: new Date('2026-01-02T03:04:05Z'), totalValue: 4, type: 0, status: 5,
    senderIdentityPublicKey: Buffer.from(WALLET, 'hex'),
  }, WALLET);
  assert.deepEqual(sent, {
    id: 'transfer-1', time: '2026-01-02T03:04:05.000Z', direction: 'out', amount_sats: 4, kind: 'lightning', status: 'completed',
  });

  const received = describeTransfer({
    id: 'transfer-2', totalValue: 9, type: 2, status: 2, senderIdentityPublicKey: Buffer.from(OTHER_WALLET, 'hex'),
  }, WALLET);
  assert.equal(received.direction, 'in');
  assert.equal(received.kind, 'spark');
  assert.equal(received.status, 'pending');
});

// ---- Tokens

test('token amounts keep their precision', () => {
  assert.equal(formatUnits(250000n, 6), '0.25');
  assert.equal(formatUnits(12345600n, 6), '12.3456');
  assert.equal(formatUnits(1000000n, 6), '1');
  assert.equal(formatUnits(1n, 6), '0.000001');
  assert.equal(formatUnits(0n, 6), '0');
  assert.equal(formatUnits(12n, 0), '12');
  assert.equal(formatUnits(123456789012345678901234567890n, 6), '123456789012345678901234.56789');
});

test('token balances and details come from the balance map', () => {
  const balances = new Map([['btkn1madeup', {
    ownedBalance: 12345600n,
    tokenMetadata: {tokenTicker: 'USDB', tokenName: 'Bitcoin USD', decimals: 6, rawTokenIdentifier: USDB_RAW_ID},
  }]]);
  assert.deepEqual(describeTokenBalances(balances), [{currency: 'USDB', name: 'Bitcoin USD', amount: '12.3456', token_id: 'btkn1madeup'}]);
  assert.deepEqual(tokensByRawId(balances).get('aa'.repeat(32)), {currency: 'USDB', decimals: 6});
  assert.deepEqual(describeTokenBalances(new Map()), []);
});

test('a token payment is in or out by who owned what it spent', () => {
  const transactions = [
    tokenTx(1, '2026-01-01T00:00:00Z', [[9, 0]], [output(WALLET, 2_000000)]),                                   // A stranger paid 2
    tokenTx(2, '2026-01-02T00:00:00Z', [[1, 0]], [output(OTHER_WALLET, 1_500000), output(WALLET, 500000)]),     // The wallet paid 1.5, change 0.5
    tokenTx(3, '2026-01-03T00:00:00Z', [[8, 1]], [output(WALLET, 250000), output(OTHER_WALLET, 19_000000)]),    // A stranger paid 0.25, their change 19
    tokenTx(4, '2026-01-04T00:00:00Z', [[2, 1], [3, 0]], [output(WALLET, 750000)]),                           // The wallet joined two of its own outputs
    tokenTx(5, '2026-01-05T00:00:00Z', [[4, 0]], [output(OTHER_WALLET, 750000)], 3),                          // The wallet tried to pay it all; cancelled
    tokenTx(6, '2026-01-06T00:00:00Z', null, [output(WALLET, 1_000000)], 0),                                    // Minted to the wallet, not final yet
  ];
  const rows = describeTokenTransactions(transactions, WALLET, USDB, 10, true);
  assert.deepEqual(rows.map(row => [row.direction, row.amount, row.status]), [
    ['in', '1', 'pending'],
    ['out', '0.75', 'failed'],
    ['self', '0.75', 'completed'],
    ['in', '0.25', 'completed'],
    ['out', '1.5', 'completed'],
    ['in', '2', 'completed'],
  ]);
  assert.equal(rows[3].currency, 'USDB');
  assert.equal(rows[3].kind, 'token');
  assert.equal(rows[3].time, '2026-01-03T00:00:00.000Z');
  assert.equal(describeTokenTransactions(transactions, WALLET, USDB, 2, true).length, 2, 'only the newest are shown');
});

test('a payment whose inputs cannot be traced is not guessed at until the whole history has been seen', () => {
  const newest = [tokenTx(3, '2026-01-03T00:00:00Z', [[8, 1]], [output(WALLET, 250000), output(OTHER_WALLET, 19_000000)])];
  assert.equal(describeTokenTransactions(newest, WALLET, USDB, 10, false)[0].direction, 'unknown');
  assert.equal(describeTokenTransactions(newest, WALLET, USDB, 10, true)[0].direction, 'in');

  const sentEverything = [tokenTx(5, '2026-01-05T00:00:00Z', [[4, 0]], [output(OTHER_WALLET, 750000)])];
  assert.equal(describeTokenTransactions(sentEverything, WALLET, USDB, 10, false)[0].direction, 'out',
    'nothing came to the wallet, so it can only have sent');

  const [unknownToken] = describeTokenTransactions(newest, WALLET, new Map(), 10, true);
  assert.deepEqual([unknownToken.amount, unknownToken.amount_base_units, unknownToken.currency], [undefined, '250000', 'token']);
});

test('sats and token rows are shown together, newest first', () => {
  const sats = [{id: 'a', time: '2026-01-03T00:00:00.000Z'}, {id: 'b', time: '2026-01-01T00:00:00.000Z'}];
  const tokens = [{id: 'c', time: '2026-01-02T00:00:00.000Z'}];
  assert.deepEqual(mergeHistory(sats, tokens, 10).map(row => row.id), ['a', 'c', 'b']);
  assert.deepEqual(mergeHistory(sats, tokens, 2).map(row => row.id), ['a', 'c']);
});
