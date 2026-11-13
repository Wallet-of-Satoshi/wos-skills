// Receiving: what Spark is asked for when an invoice is made for the owner, and how to tell it has been paid.
// Nothing here talks to the network.

const SPARK_INVOICE_PAID = 2; // Spark's InvoiceStatus.FINALIZED: paid, for the receiver and amount that were asked
const LIGHTNING_ARRIVING = ['TRANSFER_CREATED', 'PAYMENT_PREIMAGE_RECOVERED', 'LIGHTNING_PAYMENT_RECEIVED'];
const LIGHTNING_FAILED = [
  'TRANSFER_CREATION_FAILED', 'REFUND_SIGNING_COMMITMENTS_QUERYING_FAILED', 'REFUND_SIGNING_FAILED',
  'PAYMENT_PREIMAGE_RECOVERING_FAILED', 'TRANSFER_FAILED',
];

/**
 * The options for an invoice that pays the owner's wallet.
 *
 * By default the invoice carries a Spark invoice as well, so another Spark wallet can pay it directly with no
 * fee, and that payment can be traced to this invoice. A bare Spark address (the SDK's includeSparkAddress)
 * would be paid just as freely, but the payment would carry nothing to say which invoice it was for, so it is
 * never used here.
 *
 * `lightningOnly` leaves the Spark part out. The invoice is then about a third shorter, which matters for a QR
 * code, and every payer settles it over Lightning.
 */
export function invoiceOptions(walletPubKey, sats, memo, lightningOnly) {
  return {
    amountSats: sats,
    ...(memo ? {memo} : {}),
    receiverIdentityPubkey: walletPubKey,
    ...(lightningOnly ? {} : {includeSparkInvoice: true}),
  };
}

/** A transfer id as history shows it, from the 16 bytes Spark returns. */
function transferIdText(bytes) {
  const hex = Buffer.from(bytes || []).toString('hex');
  if (hex.length !== 32) {
    return undefined;
  }
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/**
 * Whether an invoice has been paid. There are two places to look, because there are two ways to pay it:
 *
 * - A payer on Spark pays the Spark invoice inside it (`spark`, its status and the transfer that paid it). The
 *   Lightning receive request is never touched and goes on reading as created.
 * - A payer on Lightning settles the receive request (`request`).
 *
 * `transfer_id` is the id of the matching row in the wallet's history.
 */
export function describeReceive(request, spark, nowMs) {
  if (spark?.status === SPARK_INVOICE_PAID) {
    return {status: 'PAID', paid_over: 'spark', transfer_id: transferIdText(spark.transferId)};
  }
  if (request.status === 'TRANSFER_COMPLETED') {
    return {status: 'PAID', paid_over: 'lightning', transfer_id: request.transfer?.sparkId};
  }
  if (LIGHTNING_ARRIVING.includes(request.status)) {
    return {status: 'ARRIVING', paid_over: 'lightning'};
  }
  if (LIGHTNING_FAILED.includes(request.status)) {
    return {status: 'FAILED', paid_over: 'lightning'};
  }
  const expiresAtMs = Date.parse(request.invoice?.expiresAt || '');
  return {status: expiresAtMs <= nowMs ? 'EXPIRED' : 'UNPAID'};
}
