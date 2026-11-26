// DUSK V4 vault client. No dependencies, Node 18+.
// Lets an AI agent pay sellers from its DUSK vault on Robinhood Chain, only inside the owner's limits.
//
//   import { createVault } from './dusk-vault.mjs';
//   const vault = createVault({ key: process.env.DUSK_AGENT_WALLET_KEY, vault: process.env.DUSK_VAULT_ID });
//   const r = await vault.pay('0xSeller…', '0.05', 'search: lithium 2026');
//   // r.ok: paid in the same transaction · r.waiting: the owner must approve · otherwise refused, nothing moved
//
// The agent wallet key signs locally and never leaves this machine.

import { readFileSync } from 'node:fs';

const ECC = new Function(readFileSync(new URL('../src/ecc.js', import.meta.url), 'utf8') + '\nreturn DUSK_ECC;')();
const enc = new TextEncoder();
export const VAULT_CONTRACT = '0x2ae5a2c5ebe591bb647b45fdbc276cb334fbcff4';
export const CHAIN_ID = 4663n;
const RPCS = ['https://robinhood-rpc.publicnode.com', 'https://rpc.mainnet.chain.robinhood.com', 'https://4663.rpc.thirdweb.com'];
const REASONS = { 2: 'no such vault', 3: 'vault closed', 4: 'vault paused by its owner', 5: 'vault expired', 6: 'over the per-payment limit', 7: 'over the daily limit', 8: 'over the per-seller daily limit', 9: 'not enough left in the vault' };

const sel = s => '0x' + ECC.bytesToHex(ECC.keccak256(enc.encode(s))).slice(0, 8);
const topic = s => '0x' + ECC.bytesToHex(ECC.keccak256(enc.encode(s)));
const w256 = v => BigInt(v).toString(16).padStart(64, '0');
const wAddr = a => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
const hexb = h => { h = String(h).replace(/^0x/, ''); if (h.length % 2) h = '0' + h; return Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)); };
const big2b = v => { v = BigInt(v); return v === 0n ? new Uint8Array(0) : hexb(v.toString(16)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const rlpLen = (l, off) => { if (l < 56) return Uint8Array.of(off + l); const b = big2b(l); return cat(Uint8Array.of(off + 55 + b.length), b); };
const rlp = x => { if (Array.isArray(x)) { const p = cat(...x.map(rlp)); return cat(rlpLen(p.length, 0xc0), p); } if (x.length === 1 && x[0] < 0x80) return x; return cat(rlpLen(x.length, 0x80), x); };
export function parseUnits(s, d) { s = String(s).trim(); if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('amount must be a decimal string, e.g. "0.05"'); const [i, f = ''] = s.split('.'); if (f.length > d) throw new Error(`at most ${d} decimals`); return BigInt(i) * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); }
export function formatUnits(v, d) { v = BigInt(v); const b = 10n ** BigInt(d), f = (v % b).toString().padStart(d, '0').replace(/0+$/, ''); return f ? `${v / b}.${f}` : String(v / b); }
const memo32 = s => { const b = enc.encode(String(s || '')).slice(0, 32); return ECC.bytesToHex(b).padEnd(64, '0'); };

export function createVault({ key, vault, contract = VAULT_CONTRACT, rpc = RPCS } = {}) {
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(String(key || ''))) throw new Error('Set DUSK_AGENT_WALLET_KEY to the agent wallet key (64 hex characters)');
  if (!/^\d+$/.test(String(vault || ''))) throw new Error('Set DUSK_VAULT_ID to your vault number');
  const d = ECC.bytesToBig(hexb(key)), N = ECC._N;
  if (!d || d >= N) throw new Error('Invalid agent wallet key');
  const Q = ECC._affine(ECC._mulAdd(d, ECC._G, 0n, ECC._G)), pub = new Uint8Array(64);
  pub.set(ECC.bigTo32(Q[0])); pub.set(ECC.bigTo32(Q[1]), 32);
  const address = '0x' + ECC.bytesToHex(ECC.keccak256(pub).slice(12));
  const id = BigInt(vault), urls = [].concat(rpc);
  let token = null;

  async function call(method, params) {
    let last = 'Robinhood Chain did not answer';
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json());
        if (r.error) { if (/revert/i.test(r.error.message || '')) throw Object.assign(new Error('reverted'), { data: r.error.data }); last = r.error.message; continue; }
        return r.result;
      } catch (e) { if (e.message === 'reverted') throw e; last = e.message; }
    }
    throw new Error(last);
  }
  const read = data => call('eth_call', [{ to: contract, data }, 'latest']);
  const words = h => (h || '0x').slice(2).match(/.{64}/g) || [];

  async function tokenInfo() {
    if (token) return token;
    const g = words(await read(sel('getVault(uint256)') + w256(id)));
    const addr = '0x' + g[2].slice(24);
    const dec = parseInt(await call('eth_call', [{ to: addr, data: sel('decimals()') }, 'latest']), 16);
    return (token = { address: addr, decimals: dec });
  }

  async function status() {
    const g = words(await read(sel('getVault(uint256)') + w256(id)));
    if (g[0] === '0'.repeat(64)) return { ok: false, error: 'No vault with this number' };
    const t = await tokenInfo(), f = x => formatUnits(BigInt('0x' + x), t.decimals);
    const today = words(await read(sel('spentToday(uint256,address)') + w256(id) + wAddr('0x0')));
    const expires = Number(BigInt('0x' + g[9])) * 1000, paused = g[13].endsWith('1'), closed = g[14].endsWith('1');
    return {
      ok: true, vault: String(id), agent: '0x' + g[1].slice(24), you: address, isYou: ('0x' + g[1].slice(24)) === address,
      status: closed ? 'closed' : paused ? 'paused' : expires <= Date.now() ? 'expired' : 'active',
      left: f(g[3]), spent: f(g[4]), perPayment: f(g[5]), daily: f(g[6]), spentToday: f(today[0]),
      sellerDaily: BigInt('0x' + g[7]) ? f(g[7]) : null, askAbove: BigInt('0x' + g[8]) ? f(g[8]) : null,
      expires: new Date(expires).toISOString(), payments: Number(BigInt('0x' + g[12])),
    };
  }

  async function canPay(seller, amount) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(seller)) throw new Error('seller must be a wallet address 0x…');
    const t = await tokenInfo(), v = parseUnits(amount, t.decimals);
    const code = parseInt(await read(sel('canPay(uint256,address,uint256)') + w256(id) + wAddr(seller) + w256(v)), 16);
    return { code, ok: code === 0, waiting: code === 1, reason: REASONS[code] || '' };
  }

  async function send(data) {
    const nonce = BigInt(await call('eth_getTransactionCount', [address, 'pending']));
    const gasPrice = BigInt(await call('eth_gasPrice', [])) * 12n / 10n;
    const gas = BigInt(await call('eth_estimateGas', [{ from: address, to: contract, data }])) * 13n / 10n;
    const f = [big2b(nonce), big2b(gasPrice), big2b(gas), hexb(contract), new Uint8Array(0), hexb(data)];
    const h = ECC.bytesToBig(ECC.keccak256(rlp([...f, big2b(CHAIN_ID), new Uint8Array(0), new Uint8Array(0)])));
    let r, s, rec;
    for (;;) {
      const k = ECC._mod(ECC.bytesToBig(crypto.getRandomValues(new Uint8Array(32))), N); if (!k) continue;
      const P = ECC._affine(ECC._mulAdd(k, ECC._G, 0n, ECC._G)); r = ECC._mod(P[0], N); if (!r) continue;
      s = ECC._mod(ECC._inv(k, N) * (h + r * d), N); if (!s) continue;
      rec = Number(P[1] & 1n); if (s > N / 2n) { s = N - s; rec ^= 1; } break;
    }
    const raw = '0x' + ECC.bytesToHex(rlp([...f, big2b(BigInt(rec) + CHAIN_ID * 2n + 35n), big2b(r), big2b(s)]));
    const hash = await call('eth_sendRawTransaction', [raw]);
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 1500));
      const rc = await call('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (rc) return { hash, rc };
    }
    return { hash, rc: null };
  }

  async function pay(seller, amount, memo = '') {
    const pre = await canPay(seller, amount);
    if (!pre.ok && !pre.waiting) return { ok: false, refused: true, reason: pre.reason };
    const t = await tokenInfo(), v = parseUnits(amount, t.decimals);
    const { hash, rc } = await send(sel('pay(uint256,address,uint256,bytes32)') + w256(id) + wAddr(seller) + w256(v) + memo32(memo));
    if (!rc) return { ok: false, pending: true, hash };
    if (rc.status !== '0x1') return { ok: false, refused: true, reason: 'reverted by the vault', hash };
    const req = (rc.logs || []).find(l => l.topics && l.topics[0] === topic('Requested(uint256,uint256,address,uint256,bytes32)'));
    if (req) return { ok: false, waiting: true, request: String(BigInt(req.topics[2])), hash };
    return { ok: true, hash, amount, seller };
  }

  return { address, vault: String(id), contract, status, canPay, pay };
}
