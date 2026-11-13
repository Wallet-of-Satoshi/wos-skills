#!/usr/bin/env node
// WosBot: read a Wallet of Satoshi wallet, create invoices that pay it, and ask its owner to make payments.
//
// Every command prints one JSON object. A command that could not do what was asked prints
// {"error": "<CODE>", "message": "..."} and exits with status 1. Run with no arguments for the list of commands.

import { forgetConnection, loadConnection, parseConnection, saveConnection } from './src/connection.mjs';
import { WosBotError } from './src/errors.mjs';
import { invoiceFromAddress, parseSats } from './src/lightning.mjs';
import { DEFAULT_WAIT_SECONDS, connectionStatus, paymentStatus, requestPayment } from './src/server.mjs';
import { createInvoice, invoiceStatus, readBalance, readHistory } from './src/spark.mjs';

const USAGE = `Usage: node wosbot.mjs <command>

Setting up
  connect <connection string>     Save the owner's connection string on this machine (- reads it from stdin)
  connection                      Whether the owner still has this agent connected
  forget                          Delete the saved connection string

Reading
  balance                         The wallet's balance in sats, and in USDB or any other token it holds
  history [--limit N]             Recent payments in and out, newest first (default 10, at most 100)

Receiving
  invoice <sats> [memo] [--lightning-only]
                                  Create a Lightning invoice that pays the owner's wallet. --lightning-only
                                  makes it shorter, for a QR code; a payer on Spark then pays a small fee
  invoice-status <request_id> [spark_invoice]
                                  Whether an invoice from "invoice" has been paid

Paying (the owner approves each payment in their app)
  pay <invoice> [--no-wait]       Ask the owner to pay a Lightning invoice, and wait for their answer
  pay-address <name@domain> <sats> [--no-wait]
                                  Ask the owner to pay a Lightning Address
  status <request_id>             What became of a payment request

The connection string is read from WOSBOT_CONNECTION, or from the file "connect" saved.`;

const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 100;
const MAX_MEMO_CHARS = 200;

/** Splits what was typed into flags and the words left over. */
function parseArgs(args) {
  const options = {wait: true, waitSeconds: DEFAULT_WAIT_SECONDS, limit: DEFAULT_HISTORY_LIMIT, lightningOnly: false};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1] || '';
    if (arg === '--no-wait') {
      options.wait = false;
    } else if (arg === '--lightning-only') {
      options.lightningOnly = true;
    } else if (arg === '--wait' && /^\d{1,4}$/.test(value)) {
      options.waitSeconds = Number(value);
      i++;
    } else if (arg === '--limit' && /^\d{1,3}$/.test(value)) {
      options.limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(value)));
      i++;
    } else {
      words.push(arg);
    }
  }
  return {options, words};
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
  }
  return text;
}

/**
 * Spark does not refuse a viewer key the owner has withdrawn: it shows that key an empty wallet. So an answer
 * with nothing in it is checked against the server before it is believed. A disconnected agent gets
 * NOT_CONNECTED instead of a misleading zero, and if the server cannot be asked the answer carries a warning.
 */
async function emptyAnswerWarning(connection) {
  try {
    await connectionStatus(connection);
    return undefined;
  } catch (error) {
    if (error.code === 'NOT_CONNECTED') {
      throw error;
    }
    return 'Could not confirm this agent is still connected. A disconnected agent is shown an empty wallet, so do not report this as the balance or the full history.';
  }
}

// Each command takes the saved connection, the words typed after it and the flags, and returns what to print.
const COMMANDS = {
  connection: (connection) => connectionStatus(connection),

  async balance(connection) {
    const {balance, empty} = await readBalance(connection);
    return {...balance, warning: empty ? await emptyAnswerWarning(connection) : undefined};
  },

  async history(connection, words, options) {
    const {transfers, empty} = await readHistory(connection, options.limit);
    return {transfers, warning: empty ? await emptyAnswerWarning(connection) : undefined};
  },

  invoice(connection, [sats, ...memoWords], options) {
    const memo = memoWords.join(' ').trim().slice(0, MAX_MEMO_CHARS);
    return createInvoice(connection, parseSats(sats), memo, options.lightningOnly);
  },

  'invoice-status': (connection, [requestId, sparkInvoice]) => invoiceStatus(connection, requestId, sparkInvoice),

  pay: (connection, [invoice], options) => requestPayment(connection, String(invoice || '').trim(), options),

  async 'pay-address'(connection, [address, sats], options) {
    const invoice = await invoiceFromAddress(address, parseSats(sats));
    const request = await requestPayment(connection, invoice, options);
    return {paid_to: String(address).trim().toLowerCase(), ...request};
  },

  status: (connection, [requestId]) => paymentStatus(connection, requestId),
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const {options, words} = parseArgs(args);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return undefined;
  }
  if (command === 'connect') {
    // Checked with the server before it is saved, so a mistyped or withdrawn string is never kept
    const text = words[0] === '-' ? await readStdin() : words[0];
    const status = await connectionStatus(parseConnection(text));
    await saveConnection(text);
    return {saved: true, ...status};
  }
  if (command === 'forget') {
    await forgetConnection();
    return {forgotten: true};
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    throw new WosBotError('UNKNOWN_COMMAND', `Unknown command "${command}". Run with no arguments for the list.`);
  }
  return COMMANDS[command](await loadConnection(), words, options);
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

main()
  .then(result => {
    if (result !== undefined) {
      print(result);
    }
    process.exit(0); // The Spark SDK keeps connections open, so the process is ended rather than left to drain
  })
  .catch(error => {
    // Only ever a code and a sentence. An unexpected error's own text is not printed, because it could carry
    // the connection string.
    const known = error instanceof WosBotError;
    print({error: known ? error.code : 'UNEXPECTED', message: known ? error.message : 'Something went wrong. Try again.'});
    process.exit(1);
  });
