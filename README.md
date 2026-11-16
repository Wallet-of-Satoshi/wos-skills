# wos-skills

Skills that let an AI agent work with a [Wallet of Satoshi](https://www.walletofsatoshi.com) wallet.

## WosBot

[`skills/wosbot`](skills/wosbot/SKILL.md) lets an agent:

- read a wallet's balance and payment history, in sats and in USDB;
- create Lightning invoices that pay the wallet;
- ask the wallet's owner to pay a Lightning invoice or Lightning Address.

The agent never holds anything that can spend. Every payment out is approved or declined by the owner in the
Wallet of Satoshi app.

### Were you just given a connection string?

If you are an AI agent and someone has pasted you a WosBot connection string, what you can do with it depends
on what you are able to do yourself. Find your case, and tell the owner plainly which one it is. Do not guess
at abilities you have not confirmed.

| You can… | What to do | What you can then do for the owner |
|---|---|---|
| Run code | Follow [`skills/wosbot/SKILL.md`](skills/wosbot/SKILL.md) | See the balance and history, create invoices, and ask for payments |
| Use MCP servers, but not run code | Use the address before the `#` as an MCP server. It describes its own tools | Ask for payments, and check how they ended. Not the balance, history or invoices |
| Neither, from a pasted message | You cannot use the string as it is. Tell the owner to add it as a connector, as described under [chat apps](#using-chatgpt-the-claude-app-or-another-chat-app) below | Nothing until they do |

Whichever it is:

- The string is a credential. Do not repeat it back, and do not send it to any other service or tool.
- You can never spend. Every payment is approved or declined by the owner in their app.
- Never ask for the wallet's recovery phrase. Nothing here needs it.

### For wallet owners

1. In the Wallet of Satoshi app, open the menu and choose **Connect your AI**.
2. Name your agent and connect it.
3. Tap **Copy for my AI** and paste the result to your agent. It is a short note followed by your connection
   string.

Treat the string like a password. Anyone who has it can see your balance and history and send you payment
requests. It cannot be used to spend. Disconnect the agent in the app at any time and the string stops working.

Pasting works for an agent that can run code on a computer, such as a coding agent. A chat app needs one more
step.

#### Using ChatGPT, the Claude app or another chat app

A chat app cannot open a connection just because you paste an address into the conversation. It can only use
tools that were added to it beforehand. So the connection has to be added once, in the chat app's own settings:

1. In the chat app, find where custom connectors or MCP servers are added. Not every app or plan offers this.
2. Add a new one. For its address, use your connection string **up to, but not including, the `#`**. In the
   Wallet of Satoshi app, tap the string itself to copy it on its own, then leave off everything from the `#`.
3. If it asks how to sign in, choose no authentication. The address already carries what it needs.

Once it is added, the chat app can ask you to make a payment and tell you how it went. You approve or decline
each one in the Wallet of Satoshi app, exactly as with any other agent.

What a chat app cannot do this way is show your balance or history, or create an invoice for you to be paid.
Those use the part of the string after the `#`, which never leaves the device it is used on, and need an agent
that can run this skill.

Two things to know before you add it:

- The address is a credential, and the chat app's provider will store it. Leaving off the part after the `#`
  keeps the key that can read your wallet out of their hands.
- We have not tried every chat app. Where an app does not accept a custom connector, this will not work there.

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
