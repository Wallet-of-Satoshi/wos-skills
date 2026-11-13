import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeReceive, invoiceOptions } from '../src/receive.mjs';
import { WALLET } from './fixtures.mjs';

const NOW = Date.parse('2026-11-13T00:00:00Z');
const INVOICE = {expiresAt: '2026-12-12T00:00:00+00:00'};
const SPARK_PAID = 2;
const SPARK_NOT_FOUND = 0;
const SPARK_PAID_FOR_SOMETHING_ELSE = 5;

test('an invoice is made for the owner, with a Spark invoice inside unless Lightning only is asked for', () => {
  assert.deepEqual(invoiceOptions(WALLET, 500, 'Coffee', false),
    {amountSats: 500, memo: 'Coffee', receiverIdentityPubkey: WALLET, includeSparkInvoice: true});
  assert.deepEqual(invoiceOptions(WALLET, 500, '', true), {amountSats: 500, receiverIdentityPubkey: WALLET});
  assert.ok(!('includeSparkAddress' in invoiceOptions(WALLET, 1, '', false)),
    'never a bare Spark address: a payment to one cannot be traced to its invoice');
});

test('an invoice paid over Spark shows on its Spark invoice, while the Lightning request still reads as created', () => {
  const created = {status: 'INVOICE_CREATED', invoice: INVOICE};
  const transferId = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  assert.deepEqual(describeReceive(created, {status: SPARK_PAID, transferId}, NOW),
    {status: 'PAID', paid_over: 'spark', transfer_id: '01234567-89ab-cdef-0123-456789abcdef'});
  assert.deepEqual(describeReceive(created, {status: SPARK_NOT_FOUND}, NOW), {status: 'UNPAID'});
  assert.deepEqual(describeReceive(created, {status: SPARK_PAID_FOR_SOMETHING_ELSE, transferId}, NOW), {status: 'UNPAID'});
  assert.deepEqual(describeReceive(created, undefined, NOW), {status: 'UNPAID'}, 'a Lightning-only invoice has no Spark invoice');
  assert.deepEqual(describeReceive(created, {status: SPARK_NOT_FOUND}, Date.parse('2026-12-13T00:00:00Z')), {status: 'EXPIRED'});
});

test('an invoice paid over Lightning shows on its receive request', () => {
  const spark = {status: SPARK_NOT_FOUND};
  assert.deepEqual(describeReceive({status: 'TRANSFER_COMPLETED', invoice: INVOICE, transfer: {sparkId: 'transfer-9'}}, spark, NOW),
    {status: 'PAID', paid_over: 'lightning', transfer_id: 'transfer-9'});
  assert.deepEqual(describeReceive({status: 'LIGHTNING_PAYMENT_RECEIVED', invoice: INVOICE}, spark, NOW),
    {status: 'ARRIVING', paid_over: 'lightning'});
  assert.deepEqual(describeReceive({status: 'TRANSFER_FAILED', invoice: INVOICE}, spark, NOW),
    {status: 'FAILED', paid_over: 'lightning'});
});
