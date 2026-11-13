# Security

The code in this repository runs on an agent's machine holding a read-only key to someone's wallet, so we want
to hear about any weakness in it quickly and privately.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead: on this repository's **Security** tab,
choose **Report a vulnerability**. Only the maintainers can see what you send.

Tell us what you found, how to reproduce it, and what an attacker could do with it. Never include a real
connection string, even one you believe has been disconnected.

## What this code can and cannot do

- It can read a wallet's balance and history and create invoices that pay the wallet, using the viewer key and
  public key in a connection string.
- It can ask the wallet's owner to make a payment. It cannot make one: the owner approves each payment in the
  Wallet of Satoshi app.
- It never holds a key that can spend, and nothing in it should ever ask for a wallet's recovery phrase.

A report is in scope if it shows this code leaking a connection string, sending the viewer key anywhere other
than Spark, misreporting a payment as made, or passing the owner a payment request other than the one asked for.
