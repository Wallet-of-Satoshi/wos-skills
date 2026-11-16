// Runs the command line against a stand-in for the Wallet of Satoshi server on this machine. Nothing leaves it: no Spark, no
// Lightning, no real wallet. The token, keys and invoice are made up.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'wos.mjs');
const TOKEN = 'wos_' + 'b'.repeat(40);
const INVOICE = 'lnbc20n1pvjluezpp5madeup';
const PREIMAGE = 'ab'.repeat(32);

let server;
let folder;
let seen; // What the stand-in server was sent
let script; // What it answers each tool with, in order

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'wos-skill-test-'));
  server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => body += chunk);
    request.on('end', () => {
      seen.push({url: request.url, authorization: request.headers.authorization, body: body && JSON.parse(body)});
      if (request.headers.authorization !== 'Bearer ' + TOKEN) {
        response.writeHead(401, {'WWW-Authenticate': 'Bearer'}).end('{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"no"}}');
        return;
      }
      const tool = JSON.parse(body).params.name;
      const answer = script[tool].length > 1 ? script[tool].shift() : script[tool][0];
      response.writeHead(200, {'Content-Type': 'application/json'})
        .end(JSON.stringify({jsonrpc: '2.0', id: 1, result: {structuredContent: answer.data, isError: answer.refused === true}}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  server.close();
  await rm(folder, {recursive: true, force: true});
});

function connectionString(token = TOKEN) {
  return `http://127.0.0.1:${server.address().port}/mcp/${token}#viewer=v1:${'A'.repeat(22)}&wallet=02${'1'.repeat(64)}`;
}

function run(args, env = {}) {
  seen = [];
  return new Promise(resolve => {
    execFile(process.execPath, [CLI, ...args], {
      env: {PATH: process.env.PATH, WOS_CONNECTION: connectionString(), WOS_CONNECTION_FILE: join(folder, 'connection'), WOS_POLL_MS: '20', ...env},
    }, (error, stdout) => resolve({code: error ? error.code : 0, stdout, json: JSON.parse(stdout)}));
  });
}

test('the token travels in a header, never in the address', async () => {
  script = {connection_status: [{data: {connected: true, name: 'Test agent'}}]};
  const result = await run(['connection']);
  assert.equal(result.code, 0);
  assert.equal(result.json.name, 'Test agent');
  assert.equal(seen[0].url, '/mcp');
  assert.equal(seen[0].authorization, 'Bearer ' + TOKEN);
});

test('pay asks once, then waits through approved to paid', async () => {
  script = {
    request_payment: [{data: {request_id: 'r'.repeat(32), status: 'PENDING', amount_sats: 2}}],
    check_payment_status: [
      {data: {request_id: 'r'.repeat(32), status: 'PENDING', amount_sats: 2}},
      {data: {request_id: 'r'.repeat(32), status: 'APPROVED', amount_sats: 2}},
      {data: {request_id: 'r'.repeat(32), status: 'PAID', amount_sats: 2, fee_sats: 3, preimage: PREIMAGE}},
    ],
  };
  const result = await run(['pay', INVOICE]);
  assert.equal(result.code, 0);
  assert.deepEqual(result.json, {request_id: 'r'.repeat(32), status: 'PAID', amount_sats: 2, fee_sats: 3, preimage: PREIMAGE});
  assert.deepEqual(seen.map(call => call.body.params.name),
    ['request_payment', 'check_payment_status', 'check_payment_status', 'check_payment_status']);
  assert.deepEqual(seen[0].body.params.arguments, {invoice: INVOICE});
});

test('a decline is an answer, not an error', async () => {
  script = {
    request_payment: [{data: {request_id: 'd'.repeat(32), status: 'PENDING', amount_sats: 2}}],
    check_payment_status: [{data: {request_id: 'd'.repeat(32), status: 'DECLINED', amount_sats: 2}}],
  };
  const result = await run(['pay', INVOICE]);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, 'DECLINED');
});

test('--no-wait returns as soon as the owner has been asked', async () => {
  script = {request_payment: [{data: {request_id: 'p'.repeat(32), status: 'PENDING', amount_sats: 2}}]};
  const result = await run(['pay', INVOICE, '--no-wait']);
  assert.equal(result.json.status, 'PENDING');
  assert.equal(seen.length, 1);
});

test('waiting gives up without calling it failed', async () => {
  script = {
    request_payment: [{data: {request_id: 'w'.repeat(32), status: 'PENDING', amount_sats: 2}}],
    check_payment_status: [{data: {request_id: 'w'.repeat(32), status: 'APPROVED', amount_sats: 2}}],
  };
  const result = await run(['pay', INVOICE, '--wait', '0']);
  assert.equal(result.code, 0);
  assert.equal(result.json.status, 'PENDING');
  assert.match(result.json.note, /status w{32}/);
});

test('the server\'s refusal is passed on with its code', async () => {
  script = {request_payment: [{refused: true, data: {code: 'TOO_MANY_PENDING', message: 'Three requests are already waiting'}}]};
  const result = await run(['pay', INVOICE]);
  assert.equal(result.code, 1);
  assert.deepEqual(result.json, {error: 'TOO_MANY_PENDING', message: 'Three requests are already waiting'});
});

test('an invoice with no amount, or for another network, never reaches the server', async () => {
  script = {};
  assert.equal((await run(['pay', 'lnbc1pvjluezpp5madeup'])).json.error, 'AMOUNT_REQUIRED');
  assert.equal((await run(['pay', 'lntb20n1pvjluezpp5madeup'])).json.error, 'INVALID_INVOICE');
  assert.equal(seen.length, 0);
});

test('a withdrawn token says to ask the owner for a new string', async () => {
  script = {};
  const result = await run(['connection'], {WOS_CONNECTION: connectionString('wos_' + 'c'.repeat(40))});
  assert.equal(result.code, 1);
  assert.equal(result.json.error, 'NOT_CONNECTED');
});

test('connect checks the string, saves it for this user only, and never prints it', async () => {
  script = {connection_status: [{data: {connected: true, name: 'Test agent'}}]};
  const file = join(folder, 'saved', 'connection');
  const env = {WOS_CONNECTION: '', WOS_CONNECTION_FILE: file};
  const result = await run(['connect', connectionString()], env);
  assert.equal(result.json.saved, true);
  assert.ok(!result.stdout.includes(TOKEN) && !result.stdout.includes('viewer'));
  assert.equal((await readFile(file, 'utf8')).trim(), connectionString());
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  assert.equal((await run(['connection'], env)).json.name, 'Test agent', 'later commands read the saved string');
  assert.equal((await run(['forget'], env)).json.forgotten, true);
  assert.equal((await run(['connection'], env)).json.error, 'NO_CONNECTION');
});

test('a string the server does not know is not saved', async () => {
  script = {};
  const file = join(folder, 'unsaved', 'connection');
  const result = await run(['connect', connectionString('wos_' + 'c'.repeat(40))], {WOS_CONNECTION: '', WOS_CONNECTION_FILE: file});
  assert.equal(result.json.error, 'NOT_CONNECTED');
  await assert.rejects(stat(file));
});
