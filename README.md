# wos-skills

Skills that let an AI agent work with a [Wallet of Satoshi](https://www.walletofsatoshi.com) wallet.

## WosBot

[`skills/wosbot`](skills/wosbot/SKILL.md) lets an agent:

- read a wallet's balance and payment history, in sats and in USDB;
- create Lightning invoices that pay the wallet;
- ask the wallet's owner to pay a Lightning invoice or Lightning Address.

The agent never holds anything that can spend. Every payment out is approved or declined by the owner in the
Wallet of Satoshi app.

### For wallet owners

1. In the Wallet of Satoshi app, open the menu and choose **WosBot for AI agents**.
2. Name your agent and connect it. Copy the connection string the app shows.
3. Give the string to your agent, along with this skill.

Treat the string like a password. Anyone who has it can see your balance and history and send you payment
requests. It cannot be used to spend. Disconnect the agent in the app at any time and the string stops working.

### For agents

Read [`skills/wosbot/SKILL.md`](skills/wosbot/SKILL.md). It explains what you may do, every command and what
each answer means.

To install, get this repository, copy the `skills/wosbot` folder into your agent's skills folder, and install
its two dependencies. Node.js 20 or newer is required.

```bash
git clone https://github.com/Wallet-of-Satoshi/wos-skills
cd wos-skills/skills/wosbot/scripts
npm ci
```

Then:

```bash
node wosbot.mjs connect '<connection string>'
node wosbot.mjs balance
```

### How it is built

A connection string has two halves, and they go to different places:

```
https://<server>/mcp/wosbot_<token>#viewer=v1:<key>&wallet=<public key>
└────────── paying out ───────────┘ └────── reading and receiving ─────┘
```

| Part | Where it is used | What it can do |
|---|---|---|
| Payment token (before the `#`) | Wallet of Satoshi's MCP server | Ask the owner for a payment, and hear how it ended |
| Viewer key and public key (after the `#`) | On the agent's machine, straight to [Spark](https://www.spark.money) | Read the balance and history, and create invoices that pay the wallet |
| The wallet's own keys | The owner's phone, and nowhere else | Spend |

Wallet of Satoshi's servers are never sent the part after the `#`, and hold no key that can read or spend from
the wallet.

### Layout

```
skills/wosbot/
  SKILL.md              What an agent reads
  scripts/
    wosbot.mjs          The command line
    src/
      connection.mjs    The connection string: reading it and keeping it
      server.mjs        Payment requests, through the MCP server
      spark.mjs         Reading the wallet and creating invoices, through Spark
      lightning.mjs     Invoices and Lightning Addresses
      history.mjs       Shaping balances and history into rows
      receive.mjs       Invoice options, and telling whether an invoice was paid
      errors.mjs
    test/
```

## Development

```bash
cd skills/wosbot/scripts
npm ci
npm test
```

The tests run offline against a stand-in server. They never contact Spark, Lightning or a real wallet. Do not
add a test that does, and never commit a real connection string.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Licence

[MIT](LICENSE)
