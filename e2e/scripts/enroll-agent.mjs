#!/usr/bin/env node
/* global process, Buffer, fetch */
// Agent enrollment v2 for the e2e seed (skills#116), the same exchange
// `secrets-bridge-agent enroll` runs:
//
//   1. create an X25519 key pair here;
//   2. POST /api/v1/agents/enroll/challenge with the token and the public
//      key; the control plane seals a 32-byte nonce to that key;
//   3. open the sealed challenge (X25519 + HKDF-SHA256 + AES-256-GCM,
//      the pkg/sealing scheme) and POST /api/v1/agents/enroll with it.
//
// The token comes on stdin, never as an argument. The bundle goes into
// --out-dir as the three files the agent reads (agent_id, agent_secret,
// private_key), each mode 0400 in a 0700 directory, created exclusively.
// Only the agent id and the key fingerprint are printed, on stderr.
//
//   printf '%s' "$TOKEN" | node enroll-agent.mjs --cp http://127.0.0.1:8080 \
//     --name e2e-agent --cluster-name e2e-cluster --provider-type vault --out-dir DIR
//
// Node 20+, no dependencies.

import { createDecipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HKDF_INFO = 'secrets-bridge.wrap.v1';
const ALGORITHM = 'x25519-hkdf-aes-gcm';

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) fail(`bad argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  for (const k of ['cp', 'name', 'cluster-name', 'provider-type', 'out-dir']) if (!out[k]) fail(`--${k} is required`);
  return out;
}

function fail(msg) {
  process.stderr.write(`enroll-agent: ${msg}\n`);
  process.exit(1);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

const b64url = (s) => Buffer.from(s, 'base64url');

async function post(cp, path, body) {
  const res = await fetch(cp + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = {};
  try {
    json = await res.json();
  } catch {
    // empty body
  }
  // Error bodies are generic codes ({"error":"enrollment_rejected"}); they
  // never echo the token, so they are safe to print.
  if (!res.ok) fail(`${path} answered ${res.status} ${typeof json.error === 'string' ? json.error : ''}`);
  return json;
}

function openSealed(env, privateKey, publicRaw) {
  if (env.algorithm !== ALGORITHM) fail(`unknown sealing algorithm ${env.algorithm}`);
  const eph = Buffer.from(env.ephemeral_public_key, 'base64');
  const nonce = Buffer.from(env.nonce, 'base64');
  const sealed = Buffer.from(env.ciphertext, 'base64');
  if (eph.length !== 32 || nonce.length !== 12 || sealed.length < 16) fail('malformed sealed challenge');
  const ephKey = createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: eph.toString('base64url') }, format: 'jwk' });
  const shared = diffieHellman({ privateKey, publicKey: ephKey });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.concat([eph, publicRaw]), HKDF_INFO, 32));
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  // Go's GCM appends the 16-byte tag to the ciphertext.
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  shared.fill(0);
  key.fill(0);
  return plain;
}

const a = args();
const token = await readStdin();
if (!token) fail('no enrollment token on stdin');

const { privateKey } = generateKeyPairSync('x25519');
const jwk = privateKey.export({ format: 'jwk' });
const publicRaw = b64url(jwk.x);
const privateRaw = b64url(jwk.d);
const fingerprint = 'sha256:' + createHash('sha256').update(publicRaw).digest('hex');

const challenge = await post(a.cp, '/api/v1/agents/enroll/challenge', {
  schema_version: '2',
  enrollment_token: token,
  public_key: publicRaw.toString('base64'),
  public_key_algorithm: 'x25519',
});
const nonce = openSealed(challenge.sealed_challenge, privateKey, publicRaw);
const enrolled = await post(a.cp, '/api/v1/agents/enroll', {
  schema_version: '2',
  enrollment_token: token,
  challenge_id: challenge.challenge_id,
  challenge_response: nonce.toString('base64'),
  name: a.name,
  cluster_name: a['cluster-name'],
  provider_type: a['provider-type'],
  ...(a.region ? { region: a.region } : {}),
});
nonce.fill(0);
if (!enrolled.agent_id || !enrolled.agent_secret) fail('enroll returned no credential');
if (enrolled.public_key_fingerprint !== fingerprint) fail('the control plane bound another key fingerprint');

mkdirSync(a['out-dir'], { mode: 0o700 });
const put = (name, value) => writeFileSync(join(a['out-dir'], name), value, { mode: 0o400, flag: 'wx' });
put('agent_id', enrolled.agent_id);
put('agent_secret', enrolled.agent_secret);
put('private_key', privateRaw.toString('base64'));
privateRaw.fill(0);
process.stderr.write(`enrolled agent ${enrolled.agent_id}, key ${fingerprint}\n`);
