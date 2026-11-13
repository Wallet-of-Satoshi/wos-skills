import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { parseConnection } from '../src/connection.mjs';
import { CONNECTION_STRING, TOKEN, WALLET, ZERO_VIEWER_KEY } from './fixtures.mjs';

test('a connection string splits into the server half and the read-only half', () => {
  const connection = parseConnection(`  ${CONNECTION_STRING}\n`);
  assert.equal(connection.endpoint, 'https://bot.example.com/mcp');
  assert.equal(connection.token, TOKEN);
  assert.equal(connection.walletPubKey, WALLET);
  assert.deepEqual(connection.viewerEntropy, new Uint8Array(16));
});

test('the viewer key is the entropy of a twelve-word phrase', () => {
  const phrase = entropyToMnemonic(parseConnection(CONNECTION_STRING).viewerEntropy, wordlist);
  assert.equal(phrase, `${'abandon '.repeat(11)}about`);
});

test('a local test server may be http, and nothing else may', () => {
  const local = CONNECTION_STRING.replace('https://bot.example.com', 'http://localhost:9000');
  assert.equal(parseConnection(local).endpoint, 'http://localhost:9000/mcp');
  assert.throws(() => parseConnection(CONNECTION_STRING.replace('https://', 'http://')), {code: 'BAD_CONNECTION_STRING'});
});

test('a string missing any part is refused', () => {
  const broken = [
    '',
    'not a url',
    `https://bot.example.com/mcp/${TOKEN}`,
    CONNECTION_STRING.replace(TOKEN, 'sometoken'),
    CONNECTION_STRING.replace(ZERO_VIEWER_KEY, `v2:${'A'.repeat(22)}`),
    CONNECTION_STRING.replace(ZERO_VIEWER_KEY, 'v1:short'),
    CONNECTION_STRING.replace(WALLET, `04${'1'.repeat(64)}`),
    `${CONNECTION_STRING}#again`,
  ];
  for (const text of broken) {
    assert.throws(() => parseConnection(text), {code: 'BAD_CONNECTION_STRING'}, text);
  }
});
