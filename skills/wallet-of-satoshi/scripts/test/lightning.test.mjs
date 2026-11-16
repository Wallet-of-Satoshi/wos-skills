import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceAmountMsat, lightningAddressUrl, parseSats } from '../src/lightning.mjs';

test('an invoice says its amount in its prefix', () => {
  assert.equal(invoiceAmountMsat('lnbc20n1pvjluezpp5'), 2000n);
  assert.equal(invoiceAmountMsat('LNBC10N1PVJLUEZPP5'), 1000n);
  assert.equal(invoiceAmountMsat('lnbc2500u1pvjluez'), 250_000_000n);
  assert.equal(invoiceAmountMsat('lnbc1m1pvjluez'), 100_000_000n);
  assert.equal(invoiceAmountMsat('lnbc21pvjluez'), 200_000_000_000n);
  assert.equal(invoiceAmountMsat('lnbc10p1pvjluez'), 1n);
  assert.equal(invoiceAmountMsat('lnbc1pvjluezpp5'), null, 'no amount');
});

test('anything but a mainnet invoice is refused', () => {
  const notMainnetInvoices = ['', 'lntb20n1pvjluez', 'lnbcrt20n1pvjluez', 'bitcoin:bc1qexample', 'lnbc20x1pvjluez', 'lnbc15p1pvjluez'];
  for (const text of notMainnetInvoices) {
    assert.throws(() => invoiceAmountMsat(text), {code: 'INVALID_INVOICE'}, text);
  }
});

test('a Lightning Address becomes its well-known address', () => {
  assert.equal(lightningAddressUrl(' Alice@Example.com '), 'https://example.com/.well-known/lnurlp/alice');
  for (const text of ['alice', 'alice@localhost', 'a/b@example.com', 'alice@example.com/x', '@example.com']) {
    assert.throws(() => lightningAddressUrl(text), {code: 'INVALID_ADDRESS'}, text);
  }
});

test('an amount is a whole number of sats', () => {
  assert.equal(parseSats('3'), 3);
  for (const text of ['0', '-1', '1.5', '1e3', '', undefined, '03']) {
    assert.throws(() => parseSats(text), {code: 'INVALID_AMOUNT'}, String(text));
  }
});
