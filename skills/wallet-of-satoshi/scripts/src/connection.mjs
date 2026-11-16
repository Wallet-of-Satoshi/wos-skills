// The connection string an owner copies from the Wallet of Satoshi app: reading it, and keeping it on this machine.

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SkillError } from './errors.mjs';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Where `connect` saves the string. WOS_CONNECTION_FILE moves it. */
export function connectionFile() {
  return process.env.WOS_CONNECTION_FILE || join(homedir(), '.config', 'wallet-of-satoshi', 'connection');
}

/**
 * Splits a connection string into its two halves:
 *
 *   https://<server>/mcp/wos_<token>#viewer=v1:<key>&wallet=<public key>
 *
 * Before the '#' is the MCP server's address, ending in the token that lets this agent ask for payments. After
 * it are the read-only viewer key and the wallet's public key, which are used with Spark directly and are never
 * sent to any server.
 */
export function parseConnection(text) {
  const [address, fragment, ...rest] = String(text || '').trim().split('#');
  if (!address || !fragment || rest.length) {
    throw new SkillError('BAD_CONNECTION_STRING', 'A connection string is an address followed by #viewer=...&wallet=...');
  }

  let url;
  try {
    url = new URL(address);
  } catch {
    throw new SkillError('BAD_CONNECTION_STRING', 'The connection string does not start with a valid address');
  }
  const isLocalTestServer = url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalTestServer) {
    throw new SkillError('BAD_CONNECTION_STRING', 'The address must be https');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const token = segments.pop() || '';
  if (!/^wos_[A-Za-z0-9]{20,100}$/.test(token)) {
    throw new SkillError('BAD_CONNECTION_STRING', 'The address does not end in a Wallet of Satoshi token');
  }

  const params = new URLSearchParams(fragment);
  const viewer = params.get('viewer') || '';
  const walletPubKey = params.get('wallet') || '';
  if (!/^v1:[A-Za-z0-9_-]{22}$/.test(viewer)) {
    throw new SkillError('BAD_CONNECTION_STRING', 'The viewer key is missing or is not a v1 key');
  }
  if (!/^0[23][0-9a-f]{64}$/.test(walletPubKey)) {
    throw new SkillError('BAD_CONNECTION_STRING', 'The wallet public key is missing or malformed');
  }
  const viewerEntropy = new Uint8Array(Buffer.from(viewer.slice(3), 'base64url'));
  if (viewerEntropy.length !== 16) {
    throw new SkillError('BAD_CONNECTION_STRING', 'The viewer key is not 16 bytes');
  }

  return {
    // The address without the token. The token is sent in a header instead, which keeps it out of the request
    // logs of anything between this machine and the server.
    endpoint: `${url.origin}/${segments.join('/')}`,
    token,
    viewerEntropy,
    walletPubKey,
  };
}

/** The saved connection, from WOS_CONNECTION if set, otherwise from the file `connect` wrote. */
export async function loadConnection() {
  let text = process.env.WOS_CONNECTION;
  if (!text) {
    try {
      text = await readFile(connectionFile(), 'utf8');
    } catch {
      throw new SkillError('NO_CONNECTION',
        'No connection string saved. Ask the owner for theirs (WoS app, menu, Connect your AI) and run: connect <string>');
    }
  }
  return parseConnection(text);
}

/** Saves the string where only this user can read it. */
export async function saveConnection(text) {
  const file = connectionFile();
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  await writeFile(file, `${String(text).trim()}\n`, {mode: 0o600});
  await chmod(file, 0o600); // writeFile's mode applies only when it creates the file
}

export async function forgetConnection() {
  await rm(connectionFile(), {force: true});
}
