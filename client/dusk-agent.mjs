// DUSK agent client. No dependencies. Node 18+, Deno, Bun, browsers, Workers.
//
//   import { createDusk } from './dusk-agent.mjs';
//   const dusk = createDusk(process.env.DUSK_AGENT_KEY);
//   const r = await dusk.spend({ amount: '0.0025', seller: 'api.vendor.dev/search', request: 'lithium supply 2026' });
//   if (r.ok) { /* pay the seller from your agent wallet */ }

const DEFAULT_URL = 'https://duskdot.fun';

const enc = new TextEncoder();
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// Seller host, normalized the same way the vault does when it builds the allowlist.
export const hostOf = seller => String(seller).trim().toLowerCase().split('://').pop().split('/')[0];

export function createDusk(agentKey, { url = DEFAULT_URL } = {}) {
  const [grantId, token, sealingKey] = String(agentKey || '').split('.');
  if (!grantId || !token || !sealingKey) throw new Error('Agent key must look like <grantId>.<token>.<sealingKey>');
  const base = url.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${grantId}.${token}` };
  const raw = unb64(sealingKey);

  // AES-GCM, 12-byte IV prepended. DUSK only ever stores the ciphertext.
  async function seal(data) {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return b64(out);
  }

  async function open(sealed) {
    const bytes = unb64(sealed);
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // HMAC-SHA256(sealingKey, host): lets DUSK check a private allowlist without learning the seller.
  async function tagOf(seller) {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(hostOf(seller)))));
  }

  // Ask DUSK before paying. Pay the seller only if ok is true.
  async function spend({ amount, seller, request = '', note = '' }) {
    const res = await fetch(`${base}/api/spend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ amount: String(amount), sealed: await seal({ seller, request, note }), tag: await tagOf(seller) }),
    });
    return res.json(); // { ok, receipt, remaining, remainingToday, ... } or { ok: false, error }
  }

  // Current limits and status of the grant.
  // Dry run: same checks as spend, nothing is spent or recorded.
  async function check({ amount, seller = '' }) {
    const res = await fetch(`${base}/api/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ amount: String(amount), tag: seller ? await tagOf(seller) : '' }),
    });
    return res.json(); // { ok: true, pass: true, ... } or { ok: false, error }
  }

  async function limits() {
    const res = await fetch(`${base}/api/agent`, { headers: auth });
    return res.json();
  }

  return { grantId, spend, check, limits, seal, open, tagOf };
}
