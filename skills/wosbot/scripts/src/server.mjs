// Payments. The agent cannot pay: it asks the WosBot server to ask the owner, and reads back how that ended.
// The server is a Model Context Protocol (MCP) server; these are its three tools, called over plain HTTP.

import { WosBotError } from './errors.mjs';
import { invoiceAmountMsat } from './lightning.mjs';

const REQUEST_TIMEOUT_MS = 30_000;
const POLL_MS = Number(process.env.WOSBOT_POLL_MS) || 5000; // The variable exists so the tests need not wait
const FINAL_STATUSES = ['PAID', 'DECLINED', 'EXPIRED', 'FAILED'];

/** The owner has five minutes to answer; the rest allows the wallet to settle after a late yes. */
export const DEFAULT_WAIT_SECONDS = 420;

/** Calls one tool and returns its data. A refusal from the server is thrown with the server's own code. */
async function callTool(connection, name, args = {}) {
  let response;
  try {
    response = await fetch(connection.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${connection.token}`,
      },
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new WosBotError('SERVER_UNREACHABLE', 'Could not reach the WosBot server. Try again shortly.');
  }
  if (response.status === 401) {
    throw new WosBotError('NOT_CONNECTED',
      'The owner has disconnected this agent, or the connection string is wrong. Ask them for a new one.');
  }
  if (response.status === 429) {
    throw new WosBotError('SLOW_DOWN', 'Too many requests. Wait a minute before trying again.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.result || body.error) {
    throw new WosBotError('SERVER_ERROR', body?.error?.message || `The WosBot server answered ${response.status}`);
  }
  const data = body.result.structuredContent || {};
  if (body.result.isError) {
    throw new WosBotError(data.code || 'REFUSED', data.message || 'The WosBot server refused the request');
  }
  return data;
}

/** Whether the owner still has this agent connected, and under what name. */
export function connectionStatus(connection) {
  return callTool(connection, 'connection_status');
}

/** What became of a payment request. */
export function paymentStatus(connection, requestId) {
  return callTool(connection, 'check_payment_status', {request_id: String(requestId || '')});
}

/**
 * Asks the owner to pay an invoice. With `wait`, keeps checking until the request ends or `waitSeconds` pass;
 * a request that has not ended by then is returned as it stands, with a note saying how to check on it later.
 */
export async function requestPayment(connection, invoice, {wait = true, waitSeconds = DEFAULT_WAIT_SECONDS} = {}) {
  if (invoiceAmountMsat(invoice) === null) {
    throw new WosBotError('AMOUNT_REQUIRED', 'The invoice names no amount. Ask the payee for one that does.');
  }
  let request = await callTool(connection, 'request_payment', {invoice});
  if (!wait) {
    return request;
  }

  const requestId = request.request_id;
  const giveUpAt = Date.now() + waitSeconds * 1000;
  while (!FINAL_STATUSES.includes(request.status) && Date.now() < giveUpAt) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    request = await paymentStatus(connection, requestId);
  }
  if (!FINAL_STATUSES.includes(request.status)) {
    request.note = `Still ${request.status} after ${waitSeconds} seconds. Check again later with: status ${requestId}`;
  }
  return request;
}
