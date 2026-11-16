---
name: wallet-of-satoshi
description: Read the balance and history of a Wallet of Satoshi wallet, create Lightning invoices that pay it, and ask its owner to make Lightning payments, each of which they approve in their app. Use when the user gives you a Wallet of Satoshi connection string (an address ending in /mcp/wos_... followed by #viewer=...&wallet=...), or asks you to check, receive into, pay from or send sats from their Wallet of Satoshi.
---

# Wallet of Satoshi

This skill connects you to one person's Wallet of Satoshi wallet. You can see its balance and history, create
invoices for it to be paid, and ask its owner to pay a Lightning invoice or Lightning Address. You cannot spend:
every payment out is approved or declined by the owner in their app, and nothing you do can change that.

The owner connects you by giving you one connection string, copied from the WoS app (menu, Connect your AI). It has two
halves, and they work differently:

```
https://<server>/mcp/wos_<token>#viewer=v1:<key>&wallet=<public key>
└────────── paying out ───────────┘ └────── reading and receiving ─────┘
```

- **Paying out** goes through the address before the `#`. It is an MCP server that takes payment requests for
  the owner to approve and tells you how they ended.
- **Reading and receiving** use the part after the `#`: a read-only Spark viewer key and the wallet's public
  key. They are used directly with Spark, on this machine. Wallet of Satoshi's servers never see them, and
  cannot read the wallet or make an invoice for you.

## Rules

- **Treat the connection string as a secret.** Anyone who has it can see the wallet's balance and history and
  send its owner payment requests. Never print it, log it, commit it, put it in a URL, or send it to any
  service. Never send the part after the `#` to any server, including the Wallet of Satoshi server.
- **Never ask for the wallet's recovery phrase**, and never accept one. Nothing here needs it.
- **Ask for a payment only when the owner wants it made.** Tell them the amount and who it is for before you
  send the request, since the approval screen shows them only the amount and the invoice.
- **Create an invoice only when the owner asks for one**, and give it only to whoever they mean to be paid by.
- **A request is not a payment.** Report a payment as made only when its status is `PAID`.
- **Do not ask again for an invoice that was declined or failed.** Tell the owner instead.
- **Stop when you are disconnected.** If a command answers `NOT_CONNECTED`, the owner has withdrawn your access.
  Run `forget` and do nothing more with the old string.

## Setup

Requires Node.js 20 or newer. Once, in this skill's `scripts` folder:

```bash
npm ci
```

Then save the owner's connection string on this machine. It is written to `~/.config/wallet-of-satoshi/connection`,
readable only by this user, and is not printed back:

```bash
node scripts/wos.mjs connect '<connection string>'
```

Alternatively set it in the `WOS_CONNECTION` environment variable, which is used in preference to the file.

## Commands

Every command prints one JSON object. A command that could not do what was asked prints
`{"error": "<CODE>", "message": "..."}` and exits with status 1.

| Command | What it does |
|---|---|
| `node scripts/wos.mjs balance` | The balance in sats, and in USDB or any other token the wallet holds |
| `node scripts/wos.mjs history --limit 10` | Recent payments in and out, sats and tokens, newest first |
| `node scripts/wos.mjs invoice <sats> [memo] [--lightning-only]` | Creates a Lightning invoice that pays the owner's wallet |
| `node scripts/wos.mjs invoice-status <request_id> [spark_invoice]` | Whether that invoice has been paid |
| `node scripts/wos.mjs pay <invoice>` | Asks the owner to pay a Lightning invoice, and waits for the outcome |
| `node scripts/wos.mjs pay-address <name@domain> <sats>` | Asks the owner to pay a Lightning Address |
| `node scripts/wos.mjs status <request_id>` | What became of a payment request |
| `node scripts/wos.mjs connection` | Whether the owner still has you connected |
| `node scripts/wos.mjs forget` | Deletes the saved connection string |

### Reading

`balance` returns `available_sats` (what can be spent now), `owned_sats` (that plus funds still moving) and
`tokens`: one entry for each token the wallet holds, with `currency` (for example `USDB`, a US dollar
stablecoin), `name` and `amount`. Token amounts are text in whole units, so `"12.5"` USDB is $12.50.
Sats and tokens are separate balances: never add them together.

`history` returns `transfers`, newest first, each with `id`, `time`, `direction`, `kind` and `status`
(`completed`, `pending`, `failed`, `expired` or `returned`). There are two shapes:

- A sats payment has `amount_sats`, and its `kind` is `lightning`, `spark`, `onchain_deposit`,
  `onchain_withdrawal` or `other`. The amount of an outgoing Lightning payment includes its fee.
- A token payment has `amount` and `currency` (for example `"0.25"` and `USDB`), and its `kind` is `token`.
  Its `direction` can also be `self`, the wallet rearranging its own funds, which is not a payment and is best
  left out of a summary, or `unknown`, when the wallet's token history is too long to say which way it went.
  For a token the wallet no longer holds, the amount is given as `amount_base_units` instead, because its
  number of decimal places is not known.

A viewer key shows the movement of funds and nothing else, so there is no description, payee, invoice or
preimage. Buying or selling USDB shows as two entries seconds apart: sats one way and USDB the other.

If either answer comes back with a `warning`, do not report it as the balance or as the full history. A
disconnected agent is shown an empty wallet rather than an error, and the warning means that could not be
ruled out.

### Receiving

`invoice` returns `invoice` (a BOLT11 invoice to give to the payer), `amount_sats`, `memo`, `expires_at`,
`request_id` and `spark_invoice`. Whoever pays it pays the owner's wallet directly. Nothing comes to you, and
the owner does not need to approve anything to be paid. The payer sees the memo, so keep it to what the owner
would want shown. Keep `request_id` and `spark_invoice`: they are how you ask about this invoice later, and
neither is secret.

By default the invoice can also be paid directly by another Spark wallet, with no fee. That makes it long,
about 630 characters. Add `--lightning-only` when a person will scan it as a QR code, or when the payer asks
for a shorter one: it is about 420 characters, has no `spark_invoice`, and a payer on a Spark wallet pays a
small Lightning fee instead of nothing. A long memo lengthens either kind, so keep it short for a QR code.

`invoice-status` takes those two values (just `request_id` for a `--lightning-only` invoice) and returns
`status`:

| Status | Meaning |
|---|---|
| `PAID` | Paid. `paid_over` says `lightning` or `spark`, and `transfer_id` is the entry's `id` in `history` |
| `ARRIVING` | A Lightning payment has been received and is being delivered to the wallet. Check again shortly |
| `UNPAID` | Not paid yet |
| `EXPIRED` | Not paid, and the invoice can no longer be paid |
| `FAILED` | A Lightning payment arrived but could not be delivered. Tell the owner |

Do not decide an invoice was paid from `history` alone. An entry of the same amount may be some other payment;
`invoice-status` is the only answer tied to this invoice. It works only with the connection that created the
invoice: after the owner connects you afresh, earlier invoices answer `INVOICE_NOT_FOUND`.

### Paying

`pay` and `pay-address` send the owner a notification and then wait, checking every five seconds, for up to
seven minutes. Add `--no-wait` to return straight away and check later with `status`.

The invoice must be a mainnet BOLT11 invoice (it starts with `lnbc`) that states its amount. `pay-address`
fetches an invoice for exactly the amount you give and refuses to pass on one for any other amount.

The answer has `request_id`, `status` and `amount_sats`:

| Status | Meaning | What to do |
|---|---|---|
| `PENDING` | The owner has not answered yet. They have five minutes. | Keep waiting, or check with `status` |
| `APPROVED` | The owner said yes and their wallet is paying. | Keep checking. Do not ask again |
| `PAID` | Paid. `fee_sats` is the fee. `preimage`, when present, is the proof of payment. | Tell the owner. Give the payee the preimage if they ask for proof |
| `DECLINED` | The owner said no. | Tell the owner. Do not ask again |
| `EXPIRED` | Nobody answered in time. | You may ask again while the invoice is still valid |
| `FAILED` | The wallet could not make the payment. | Tell the owner. Do not ask again |

A payment made to another Spark wallet has no preimage and a fee of 0.

### Errors

| Code | Meaning |
|---|---|
| `NO_CONNECTION` | No connection string is saved. Ask the owner for one |
| `BAD_CONNECTION_STRING` | The string is incomplete or malformed. Ask the owner to copy it again |
| `NOT_CONNECTED` | The owner disconnected you, or replaced this string. Ask them for a new one |
| `AMOUNT_REQUIRED`, `INVALID_INVOICE`, `WRONG_NETWORK` | The invoice cannot be used. Ask the payee for a mainnet invoice with an amount |
| `INVOICE_EXPIRED`, `INVOICE_EXPIRES_TOO_SOON` | Ask the payee for a fresh invoice |
| `TOO_MANY_PENDING` | Three requests are already waiting for the owner. Wait for an answer |
| `TOO_MANY_ATTEMPTS` | This invoice has been asked for three times. Stop, and tell the owner |
| `AMOUNT_OUT_OF_RANGE`, `ADDRESS_REFUSED`, `ADDRESS_UNREACHABLE`, `INVALID_ADDRESS` | The Lightning Address could not supply an invoice |
| `UNAVAILABLE` | Payment requests are switched off for now |
| `SPARK_UNREACHABLE`, `INVOICE_NOT_CREATED` | Spark could not be read, or could not create the invoice. Wait, then try once more |
| `INVALID_REQUEST_ID`, `INVALID_SPARK_INVOICE` | Pass the `request_id` and `spark_invoice` exactly as `invoice` returned them |
| `INVOICE_NOT_FOUND` | That invoice was not created with this connection, so its status cannot be read |
| `INVALID_AMOUNT`, `UNKNOWN_COMMAND` | The command was mistyped. Run with no arguments for the list |
| `UNEXPECTED` | Something else went wrong. Try once more, then tell the owner |
| `SLOW_DOWN`, `SERVER_UNREACHABLE`, `SERVER_ERROR`, `TRY_AGAIN` | Wait, then try once more |

## If you cannot run code

You can still ask for payments. Add the address before the `#` as an MCP server; it describes its own tools
(`request_payment`, `check_payment_status`, `connection_status`). You will not be able to read the balance or
history, or create an invoice, because those need the Spark SDK running next to you. Say so rather than
guessing a balance.

## How the reading and receiving half works

For anyone implementing this without the script:

1. `viewer=v1:<22 characters>` is the base64url encoding of 16 bytes. Those bytes are the entropy of a 12-word
   BIP39 English mnemonic.
2. `SparkReadonlyClient.createWithViewerKey({network: 'MAINNET'}, mnemonic)` from `@buildonspark/spark-sdk`
   gives a read-only client. The owner's wallet has named the key that mnemonic derives as its viewer.
3. `wallet=<66 hex characters>` is the wallet's identity public key.
   `encodeSparkAddress({identityPublicKey, network: 'MAINNET'})` turns it into the Spark address the client's
   `getAvailableBalance`, `getOwnedBalance` and `getTransfers` take. Tokens are read separately, with
   `getTokenBalance` and `getTokenTransactions`. A token transaction names the owner of each output but not of
   what it spent, so its direction comes from finding the spent outputs in the wallet's earlier transactions.
4. To receive, start an ordinary `SparkWallet` on the same mnemonic and call
   `createLightningInvoice({amountSats, memo, receiverIdentityPubkey: <the wallet's public key>, includeSparkInvoice: true})`.
   Spark lets any wallet ask for an invoice on another's behalf. The wallet started on the viewer mnemonic holds
   no funds and is not the receiver.
5. That invoice can be paid two ways. A payer on Lightning settles the receive request
   (`getLightningReceiveRequest(id)` reads `TRANSFER_COMPLETED`). A payer on Spark pays the Spark invoice inside
   it instead (`getSparkInvoices({invoices: [sparkInvoice]})` reads `FINALIZED` and names the transfer), and the
   receive request goes on reading `INVOICE_CREATED`. Check both. `includeSparkAddress` would embed a bare Spark
   address, and a Spark payment to that carries nothing that says which invoice it was for. Leaving both options
   out gives a shorter invoice that can only be paid over Lightning.

The viewer key cannot spend from the wallet or claim funds sent to it. When the owner disconnects you, it
stops working and the payment token is refused.
