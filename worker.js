const DUSK_ECC = (() => {
  const M64 = (1n << 64n) - 1n;
  const RC = [0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
  const ROT = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
  const rotl = (x, n) => n === 0 ? x : (((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
  function keccakF(s) {
    const C = new Array(5), B = new Array(25);
    for (let round = 0; round < 24; round++) {
      for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (let x = 0; x < 5; x++) {
        const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) s[y + x] ^= d;
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[i], ROT[i]);
      }
      for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++)
        s[y + x] = B[y + x] ^ ((~B[y + (x + 1) % 5] & M64) & B[y + (x + 2) % 5]);
      s[0] ^= RC[round];
    }
  }
  function keccak256(bytes) {
    const rate = 136;
    const len = bytes.length, padLen = rate - (len % rate);
    const msg = new Uint8Array(len + padLen);
    msg.set(bytes); msg[len] ^= 0x01; msg[msg.length - 1] ^= 0x80;
    const s = new Array(25).fill(0n);
    for (let off = 0; off < msg.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) {
        let lane = 0n;
        for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
        s[i] ^= lane;
      }
      keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) { let lane = s[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; } }
    return out;
  }
  const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  function inv(a, m = P) {
    let lm = 1n, hm = 0n, low = mod(a, m), high = m;
    while (low > 1n) { const r = high / low; [lm, hm] = [hm - lm * r, lm]; [low, high] = [high - low * r, low]; }
    return mod(lm, m);
  }
  function powmod(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  const INF = [0n, 1n, 0n];
  function dbl(p) {
    const [X, Y, Z] = p; if (Z === 0n || Y === 0n) return INF;
    const YY = Y * Y % P, S = 4n * X % P * YY % P, M = 3n * X % P * X % P;
    const X3 = mod(M * M - 2n * S), Y3 = mod(M * (S - X3) - 8n * YY % P * YY);
    return [X3, Y3, 2n * Y % P * Z % P];
  }
  function add(p, q) {
    if (p[2] === 0n) return q; if (q[2] === 0n) return p;
    const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
    const Z1Z1 = Z1 * Z1 % P, Z2Z2 = Z2 * Z2 % P;
    const U1 = X1 * Z2Z2 % P, U2 = X2 * Z1Z1 % P;
    const S1 = Y1 * Z2 % P * Z2Z2 % P, S2 = Y2 * Z1 % P * Z1Z1 % P;
    if (U1 === U2) return S1 === S2 ? dbl(p) : INF;
    const H = mod(U2 - U1), R = mod(S2 - S1), HH = H * H % P, HHH = HH * H % P, V = U1 * HH % P;
    const X3 = mod(R * R - HHH - 2n * V), Y3 = mod(R * (V - X3) - S1 * HHH);
    return [X3, Y3, H * Z1 % P * Z2 % P];
  }
  function affine(p) { if (p[2] === 0n) return null; const zi = inv(p[2]), zi2 = zi * zi % P; return [p[0] * zi2 % P, p[1] * zi2 % P * zi % P]; }
  function mulAdd(u1, A, u2, B) {
    const AB = add(A, B); let R = INF;
    for (let i = 255; i >= 0; i--) {
      R = dbl(R);
      const a = (u1 >> BigInt(i)) & 1n, b = (u2 >> BigInt(i)) & 1n;
      if (a && b) R = add(R, AB); else if (a) R = add(R, A); else if (b) R = add(R, B);
    }
    return R;
  }
  const hexToBytes = (h) => { h = h.replace(/^0x/i, ''); if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error('bad hex'); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
  const bytesToHex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const bytesToBig = (b) => BigInt('0x' + (bytesToHex(b) || '0'));
  const bigTo32 = (n) => hexToBytes(n.toString(16).padStart(64, '0'));
  const utf8 = (s) => new TextEncoder().encode(s);
  function hashMessage(text) {
    const m = utf8(text), pre = utf8('\x19Ethereum Signed Message:\n' + m.length);
    const all = new Uint8Array(pre.length + m.length); all.set(pre); all.set(m, pre.length);
    return keccak256(all);
  }
  function recoverAddress(text, sigHex) {
    const sig = hexToBytes(sigHex);
    if (sig.length !== 65) throw new Error('bad signature length');
    const r = bytesToBig(sig.slice(0, 32)), s = bytesToBig(sig.slice(32, 64));
    let v = sig[64]; if (v >= 27) v -= 27;
    if (v > 1 || r <= 0n || r >= N || s <= 0n || s >= N || r >= P) throw new Error('bad signature');
    const y2 = mod(r * r % P * r + 7n), y0 = powmod(y2, (P + 1n) / 4n);
    if (y0 * y0 % P !== y2) throw new Error('bad signature');
    const y = (y0 & 1n) === BigInt(v) ? y0 : P - y0;
    const e = mod(bytesToBig(hashMessage(text)), N), ri = inv(r, N);
    const u1 = mod(-e * ri, N), u2 = mod(s * ri, N);
    const Q = affine(mulAdd(u1, [GX, GY, 1n], u2, [r, y, 1n]));
    if (!Q) throw new Error('bad signature');
    const pub = new Uint8Array(64); pub.set(bigTo32(Q[0])); pub.set(bigTo32(Q[1]), 32);
    return '0x' + bytesToHex(keccak256(pub).slice(12));
  }
  return { keccak256, hashMessage, recoverAddress, hexToBytes, bytesToHex, _mulAdd: mulAdd, _affine: affine, _G: [GX, GY, 1n], _N: N, _inv: inv, _mod: mod, bigTo32, bytesToBig };
})();

// DUSK Worker — API + static site
// KV binding: DB · Static assets binding: ASSETS

const MICRO = 1000000;
const PAGE = 100;
const MAX_GRANTS = 50;
const RPC_DEFAULT = 'https://rpc.mainnet.chain.robinhood.com';
const FREE_GRANTS = 3, HOLDER_GRANTS = 50, MAX_ALLOW = 32, MAX_ANCHORS = 50;
const SESSION_TTL = 86400;

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
};
const err = (msg, status = 400) => json({ ok: false, error: msg }, status, CORS);

const enc = new TextEncoder();
async function sha256hex(s) {
  const h = await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomToken(n = 24) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const isAddr = a => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a);
const isId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(s);
const isB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[A-Za-z0-9+/=_-]+$/.test(s);

function toMicro(v) {
  if (typeof v !== 'string' || !/^\d{1,9}(\.\d{1,6})?$/.test(v)) return null;
  const [i, f = ''] = v.split('.');
  const m = Number(i) * MICRO + Number((f + '000000').slice(0, 6));
  return Number.isSafeInteger(m) ? m : null;
}
const fromMicro = m => {
  const i = Math.floor(m / MICRO), f = String(m % MICRO).padStart(6, '0').replace(/0+$/, '');
  return f ? `${i}.${f}` : String(i);
};
const dayKey = t => new Date(t).toISOString().slice(0, 10);

function grantMessage(g) {
  const lines = [
    'DUSK grant',
    `Grant: ${g.id}`,
    `Owner: ${g.owner}`,
    `Budget: ${g.budget} USDC`,
    `Per call: ${g.perCall} USDC`,
    `Daily: ${g.daily} USDC`,
  ];
  if (g.allowHash) lines.push(`Allowlist: ${g.allowHash}`);
  if (g.approveAbove) lines.push(`Ask owner above: ${g.approveAbove} USDC`);
  if (g.sellerDaily) lines.push(`Per seller daily: ${g.sellerDaily} USDC`);
  lines.push(`Expires: ${g.expires}`, `Issued: ${g.issued}`);
  return lines.join('\n');
}
function anchorData(id, count, head) {
  return '0x' + [...enc.encode(`DUSK anchor\n${id}\n${count}\n${head}`)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function loginMessage(address, issued, nonce) {
  return `DUSK sign-in\n\nAddress: ${address}\nIssued: ${issued}\nNonce: ${nonce}`;
}

async function getJSON(env, key, fallback = null) {
  const v = await env.DB.get(key, 'json');
  return v === null ? fallback : v;
}
const putJSON = (env, key, val, opts) => env.DB.put(key, JSON.stringify(val), opts);

async function rateLimit(env, key, max, windowSec = 60) {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = Number((await env.DB.get(k)) || 0);
  if (n >= max) return false;
  await env.DB.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
  return true;
}

async function bumpStats(env, patch) {
  const s = await getJSON(env, 'stats', { grants: 0, payments: 0, volume: 0, owners: 0 });
  for (const k of Object.keys(patch)) s[k] = (s[k] || 0) + patch[k];
  await putJSON(env, 'stats', s);
}
async function pushFeed(env, item) {
  const f = await getJSON(env, 'feed', []);
  f.unshift(item);
  await putJSON(env, 'feed', f.slice(0, 40));
}

async function sessionAddress(req, env) {
  const h = req.headers.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  return await env.DB.get(`sess:${t}`);
}

const RPC_FALLBACKS = ['https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org', 'https://4663.rpc.thirdweb.com', 'https://rpc.mainnet.chain.robinhood.com', 'https://robinhoodchain.blockscout.com/api/eth-rpc'];
let RPC_LAST_ERROR = '';
async function rpc(env, method, params) {
  const urls = [...new Set([env.RPC_URL, ...RPC_FALLBACKS].filter(Boolean))];
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let last = 'RPC error'; const errs = [];
  for (let round = 0; round < 2; round++) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; DUSK/1.0; +https://duskdot.fun)' }, body });
        const t = await r.text();
        if (!r.ok) { last = `${new URL(url).host} HTTP ${r.status}`; errs.push(last); continue; }
        let j; try { j = JSON.parse(t); } catch { last = `${new URL(url).host} non-JSON`; errs.push(last); continue; }
        if (j.error) { last = `${new URL(url).host} ${j.error.message || 'RPC error'}`; errs.push(last); continue; }
        if (j.result === undefined || j.result === null) { last = `${new URL(url).host} empty result`; errs.push(last); continue; }
        RPC_LAST_ERROR = '';
        return j.result;
      } catch (e) { last = `${new URL(url).host} ${e && e.message || 'fetch failed'}`; errs.push(last); }
    }
    if (round === 0) await new Promise(r => setTimeout(r, 400));
  }
  RPC_LAST_ERROR = errs.join(' | ');
  throw new Error(method + ': ' + errs.join(' | '));
}
async function tierInfo(env) {
  const ca = ((await env.DB.get('ca')) || '').trim();
  let min = ((await env.DB.get('tier_min')) || '100000').trim();
  if (!/^\d{1,15}$/.test(min)) min = '100000';
  return { ca: /^0x[0-9a-fA-F]{40}$/.test(ca) ? ca.toLowerCase() : '', min };
}
async function tierOf(env, addr) {
  const { ca, min } = await tierInfo(env);
  if (!ca) return { gated: false, holder: true, min, balance: null, grants: HOLDER_GRANTS };
  const ck = `bal:${ca}:${addr}`;
  let c = await getJSON(env, ck);
  if (!c) {
    let dec = await env.DB.get(`dec:${ca}`);
    if (dec === null) {
      dec = String(parseInt(await rpc(env, 'eth_call', [{ to: ca, data: '0x313ce567' }, 'latest']), 16));
      if (!/^\d{1,2}$/.test(dec)) throw new Error('Token decimals unreadable');
      await env.DB.put(`dec:${ca}`, dec);
    }
    const raw = await rpc(env, 'eth_call', [{ to: ca, data: '0x70a08231' + addr.slice(2).padStart(64, '0') }, 'latest']);
    c = { raw: BigInt(!raw || raw === '0x' ? 0 : raw).toString(), dec: Number(dec) };
    await putJSON(env, ck, c, { expirationTtl: 120 });
  }
  const unit = 10n ** BigInt(c.dec), raw = BigInt(c.raw), holder = raw >= BigInt(min) * unit;
  return { gated: true, holder, min, balance: (raw / unit).toString(), grants: holder ? HOLDER_GRANTS : FREE_GRANTS };
}
async function entryHash(env, g, n) {
  const page = await getJSON(env, `l:${g.id}:${Math.floor((n - 1) / PAGE)}`, []);
  const e = page.find(x => x.n === n);
  return e ? e.hash : null;
}
function publicGrant(g) {
  return {
    id: g.id, owner: g.owner, budget: g.budget, perCall: g.perCall, daily: g.daily,
    expires: g.expires, issued: g.issued, signature: g.signature, status: g.status,
    count: g.count, head: g.head,
    allowHash: g.allowHash || '', allowCount: (g.allow || []).length, anchors: g.anchors || [],
    approveAbove: g.approveAbove || '', sellerDaily: g.sellerDaily || '',
  };
}
function ownerGrant(g) {
  const today = dayKey(Date.now());
  return {
    ...publicGrant(g),
    encName: g.encName, wrappedKey: g.wrappedKey, encAllow: g.encAllow || '',
    spent: fromMicro(g.spentMicro),
    remaining: fromMicro(Math.max(0, toMicro(g.budget) - g.spentMicro)),
    spentToday: fromMicro(g.day === today ? g.daySpentMicro : 0),
    lastAt: g.lastAt || null,
    forecast: forecast(g),
    pending: (g.pending || []).filter(x => x.status === 'pending' && Date.parse(x.exp) > Date.now()).map(x => ({ id: x.id, t: x.t, amount: x.amount, sealed: x.sealed, exp: x.exp })),
  };
}

/* ---------- V3.5: budget forecast ---------- */
function forecast(g, now = Date.now()) {
  const budget = toMicro(g.budget) || 0, left = Math.max(0, budget - g.spentMicro);
  const iss = Date.parse(g.issued) || now, exp = Date.parse(g.expires) || now;
  const days = Math.max(1, (now - iss) / 86400e3);
  const pace = Math.min(toMicro(g.daily) || 0, Math.round(g.spentMicro / days));
  const low = budget > 0 && left < budget * 0.2;
  const base = { left: fromMicro(left), leftPct: budget ? Math.round((left / budget) * 1000) / 10 : 0, low };
  if (!pace) return { ...base, pace: '0', daysLeft: null, runsOut: null, outlasts: true };
  const daysLeft = left / pace, at = now + daysLeft * 86400e3;
  return { ...base, pace: fromMicro(pace), daysLeft: Math.floor(daysLeft * 10) / 10, runsOut: at < exp ? new Date(at).toISOString() : null, outlasts: at >= exp };
}
/* ---------- V3.5: seller-side checks ---------- */
function coverError(g, amt, now) {
  const daySpent = g.day === dayKey(now) ? g.daySpentMicro : 0;
  if (g.status !== 'active') return `Grant is ${g.status}`;
  if (Date.parse(g.expires) <= now) return 'Grant expired';
  if (amt > toMicro(g.perCall)) return `Over per-call limit (${g.perCall} USDC)`;
  if (daySpent + amt > toMicro(g.daily)) return 'Over the daily limit for today';
  if (g.spentMicro + amt > toMicro(g.budget)) return 'Over the remaining budget';
  return '';
}

/* ---------- V4: on-chain vault ---------- */
const V4_TOKEN = { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', decimals: 6 };
const V4_READ = new Set(['eth_call', 'eth_getTransactionReceipt', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_chainId']);
async function rpcRaw(env, method, params) {
  const urls = [...new Set([env.RPC_URL, ...RPC_FALLBACKS].filter(Boolean))];
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let last = 'RPC error';
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; DUSK/1.0; +https://duskdot.fun)' }, body });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (j.error) { if (/revert/i.test(j.error.message || '')) return { error: j.error }; last = j.error.message || 'RPC error'; continue; }
      return { result: j.result === undefined ? null : j.result };
    } catch (e) { last = String(e && e.message || e); }
  }
  throw new Error(last);
}
const v4Topic = sig => '0x' + DUSK_ECC.bytesToHex(DUSK_ECC.keccak256(enc.encode(sig)));
async function v4Addr(env) { const a = ((await env.DB.get('v4')) || '').trim().toLowerCase(); return /^0x[0-9a-f]{40}$/.test(a) ? a : ''; }

async function readBody(req, max = 16384) {
  const t = await req.text();
  if (t.length > max) throw Object.assign(new Error('Request too large'), { status: 413 });
  try { return JSON.parse(t) || {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

/* ---------- V3: limits, per-seller caps, owner approvals ---------- */
const sellerSpentToday = (g, tag) => (g.sellerDay && g.sellerDay.day === dayKey(Date.now()) ? (g.sellerDay.spent[tag] || 0) : 0);
function limitError(g, amt, tag, now) {
  const today = dayKey(now), daySpent = g.day === today ? g.daySpentMicro : 0;
  if (g.status !== 'active') return [`Grant is ${g.status}`, 403];
  if (Date.parse(g.expires) <= now) return ['Grant expired', 403];
  if (g.allow && g.allow.length && !g.allow.includes(tag)) return ["Seller is not on this grant's private allowlist", 403];
  if (amt > toMicro(g.perCall)) return [`Over per-call limit (${g.perCall} USDC)`, 402];
  if (g.sellerDaily) {
    if (!tag) return ['This grant caps each seller: send the seller tag', 400];
    if (sellerSpentToday(g, tag) + amt > toMicro(g.sellerDaily)) return [`Over per-seller daily limit (${g.sellerDaily} USDC)`, 402];
  }
  if (daySpent + amt > toMicro(g.daily)) return [`Over daily limit (${g.daily} USDC)`, 402];
  if (g.spentMicro + amt > toMicro(g.budget)) return [`Over budget (${fromMicro(Math.max(0, toMicro(g.budget) - g.spentMicro))} USDC left)`, 402];
  return null;
}
async function recordPayment(env, g, amt, sealed, tag, now) {
  const today = dayKey(now), daySpent = g.day === today ? g.daySpentMicro : 0;
  const n = g.count + 1, ts = new Date(now).toISOString(), amount = fromMicro(amt);
  const hash = await sha256hex(`${g.head}|${n}|${ts}|${amount}|${sealed}`);
  const entry = { n, t: ts, amount, sealed, prev: g.head, hash };
  const pageKey = `l:${g.id}:${Math.floor((n - 1) / PAGE)}`;
  const page = await getJSON(env, pageKey, []);
  page.push(entry);
  await putJSON(env, pageKey, page);
  if (g.sellerDaily && tag) {
    if (!g.sellerDay || g.sellerDay.day !== today) g.sellerDay = { day: today, spent: {} };
    if (Object.keys(g.sellerDay.spent).length < 300 || g.sellerDay.spent[tag]) g.sellerDay.spent[tag] = (g.sellerDay.spent[tag] || 0) + amt;
  }
  g.count = n; g.head = hash; g.spentMicro += amt; g.day = today; g.daySpentMicro = daySpent + amt; g.lastAt = ts;
  await putJSON(env, `g:${g.id}`, g);
  if (!g.demo) {
    await bumpStats(env, { payments: 1, volume: amt });
    await pushFeed(env, { t: ts, k: 'pay' });
  }
  return { grant: g.id, n, t: ts, amount, prev: entry.prev, hash };
}
async function decideRequest(env, g, rid, decision, now) {
  const it = (g.pending || []).find(x => x.id === rid);
  if (!it) return [{ ok: false, error: 'No such request' }, 404];
  if (it.status !== 'pending') return [{ ok: false, error: `Request already ${it.status}` }, 400];
  if (Date.parse(it.exp) <= now) { it.status = 'expired'; await putJSON(env, `g:${g.id}`, g); return [{ ok: false, error: 'Request expired' }, 400]; }
  if (decision === 'decline') { it.status = 'declined'; it.reason = 'Declined by the owner'; await putJSON(env, `g:${g.id}`, g); return [{ ok: true, status: 'declined' }, 200]; }
  const amt = toMicro(it.amount), le = limitError(g, amt, it.tag, now);
  if (le) { it.status = 'declined'; it.reason = le[0]; await putJSON(env, `g:${g.id}`, g); return [{ ok: false, error: le[0] }, le[1]]; }
  it.status = 'approved';
  const receipt = await recordPayment(env, g, amt, it.sealed, it.tag, now);
  it.receipt = receipt; delete it.sealed;
  await putJSON(env, `g:${g.id}`, g);
  return [{ ok: true, status: 'approved', receipt }, 200];
}

async function api(req, env, url) {
  const p = url.pathname, m = req.method;
  if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (p === '/api/stats' && m === 'GET') {
    const s = await getJSON(env, 'stats', { grants: 0, payments: 0, volume: 0, owners: 0 });
    return json({ ok: true, grants: s.grants, payments: s.payments, owners: s.owners, volume: fromMicro(s.volume) });
  }
  if (p === '/api/feed' && m === 'GET') {
    return json({ ok: true, feed: await getJSON(env, 'feed', []) });
  }
  if (p === '/api/health' && m === 'GET') {
    try { const b = await rpc(env, 'eth_blockNumber', []); return json({ ok: true, rpc: true, block: parseInt(b, 16) }); }
    catch (e) { return json({ ok: true, rpc: false, error: String(e && e.message || e) }); }
  }
  if (p === '/api/tier' && m === 'GET') {
    const qa = (url.searchParams.get('address') || '').trim().toLowerCase();
    if (qa) {
      if (!/^0x[0-9a-f]{40}$/.test(qa)) return err('That is not a wallet address');
      let t; try { t = await tierOf(env, qa); } catch { return err('Could not read this balance on Robinhood Chain. Try again.', 503); }
      return json({ ok: true, address: qa, gated: t.gated, holder: t.holder, min: t.min, balance: t.balance, grants: t.grants }, 200, CORS);
    }
    const { ca, min } = await tierInfo(env);
    return json({ ok: true, gated: !!ca, min, freeGrants: FREE_GRANTS, holderGrants: HOLDER_GRANTS });
  }
  if (p === '/api/v4' && m === 'GET') {
    return json({ ok: true, address: await v4Addr(env), chainId: 4663, token: V4_TOKEN, explorer: 'https://robinhoodchain.blockscout.com' }, 200, CORS);
  }
  if (p === '/api/chain' && m === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    if (!(await rateLimit(env, `chain:${ip}`, 240))) return err('Rate limit: 240 reads per minute', 429);
    const b = await readBody(req, 6000);
    if (!V4_READ.has(b.method) || !Array.isArray(b.params)) return err('Read-only methods only');
    try { const r = await rpcRaw(env, b.method, b.params); return json({ ok: true, ...r }, 200, CORS); }
    catch (e) { return err('Robinhood Chain did not answer. Try again.', 503); }
  }
  // Seller check for V4: did this transaction pay me from a DUSK vault?
  if (p === '/api/v4/paid' && m === 'GET') {
    const tx = (url.searchParams.get('tx') || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(tx)) return err('tx must be a transaction hash');
    const va = await v4Addr(env);
    if (!va) return err('The DUSK vault contract is not live yet', 404);
    let rc; try { rc = (await rpcRaw(env, 'eth_getTransactionReceipt', [tx])).result; } catch { return err('Robinhood Chain did not answer. Try again.', 503); }
    if (!rc) return json({ ok: true, found: false, status: 'pending or unknown' }, 200, CORS);
    const topic = v4Topic('Paid(uint256,address,uint256,uint256,bytes32)');
    const pays = (rc.logs || []).filter(l => (l.address || '').toLowerCase() === va && l.topics && l.topics[0] === topic).map(l => {
      const d = l.data.slice(2);
      return { vault: String(BigInt(l.topics[1])), seller: '0x' + l.topics[2].slice(26), amount: BigInt('0x' + d.slice(0, 64)).toString(), n: String(BigInt('0x' + d.slice(64, 128))), memo: '0x' + d.slice(128, 192) };
    });
    const sel = v4Topic('getVault(uint256)').slice(0, 10);
    for (const x of pays) {
      try {
        const r = (await rpcRaw(env, 'eth_call', [{ to: va, data: sel + BigInt(x.vault).toString(16).padStart(64, '0') }, 'latest'])).result || '';
        x.token = '0x' + r.slice(2 + 64 * 2 + 24, 2 + 64 * 3);
        x.owner = '0x' + r.slice(2 + 24, 2 + 64);
      } catch {}
    }
    return json({ ok: true, found: true, success: rc.status === '0x1', block: parseInt(rc.blockNumber, 16), contract: va, payments: pays }, 200, CORS);
  }
  if (p === '/api/agent01' && m === 'GET') return a1Public(env);
  if (p === '/api/ca' && m === 'GET') {
    return json({ ok: true, ca: (await env.DB.get('ca')) || '' });
  }

  // Owner sign-in
  if (p === '/api/login' && m === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'x';
    if (!(await rateLimit(env, `login:${ip}`, 20))) return err('Too many attempts. Wait a minute.', 429);
    const b = await readBody(req);
    const address = String(b.address || '').toLowerCase();
    if (!isAddr(address)) return err('Invalid address');
    const issued = String(b.issued || ''), nonce = String(b.nonce || '');
    const t = Date.parse(issued);
    if (!t || Math.abs(Date.now() - t) > 10 * 60 * 1000) return err('Sign-in expired. Try again.');
    if (!/^[A-Za-z0-9_-]{12,40}$/.test(nonce)) return err('Invalid nonce');
    if (await env.DB.get(`nonce:${nonce}`)) return err('Sign-in already used');
    let signer;
    try { signer = DUSK_ECC.recoverAddress(loginMessage(address, issued, nonce), String(b.signature || '')); }
    catch { return err('Invalid signature'); }
    if (signer !== address) return err('Signature does not match this wallet', 401);
    await env.DB.put(`nonce:${nonce}`, '1', { expirationTtl: 1200 });
    const token = randomToken(32);
    await env.DB.put(`sess:${token}`, address, { expirationTtl: SESSION_TTL });
    const owner = await getJSON(env, `o:${address}`);
    if (!owner) {
      await putJSON(env, `o:${address}`, { grants: [], check: null, since: new Date().toISOString() });
      await bumpStats(env, { owners: 1 });
    }
    return json({ ok: true, token, expiresIn: SESSION_TTL });
  }

  if (p === '/api/logout' && m === 'POST') {
    const h = req.headers.get('authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (/^[A-Za-z0-9_-]{20,64}$/.test(t)) await env.DB.delete(`sess:${t}`);
    return json({ ok: true });
  }

  // Owner vault
  if (p === '/api/vault' && m === 'GET') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const o = await getJSON(env, `o:${addr}`, { grants: [], check: null });
    const grants = (await Promise.all(o.grants.map(id => getJSON(env, `g:${id}`)))).filter(Boolean).map(ownerGrant);
    let tier; try { tier = await tierOf(env, addr); } catch { tier = { gated: true, error: 'Could not read your $DUSK balance on Robinhood Chain right now.' }; }
    return json({ ok: true, address: addr, check: o.check, grants, tier });
  }
  if (p === '/api/vault/check' && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const b = await readBody(req);
    if (!isB64(b.check, 200)) return err('Invalid check');
    const o = await getJSON(env, `o:${addr}`, { grants: [], check: null });
    if (o.check) return json({ ok: true, check: o.check });
    o.check = b.check;
    await putJSON(env, `o:${addr}`, o);
    return json({ ok: true, check: o.check });
  }

  if (p === '/api/grants' && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    if (!(await rateLimit(env, `grant:${addr}`, 6))) return err('Slow down. Try again in a minute.', 429);
    const b = await readBody(req);
    const g = b.grant || {};
    if (!isId(g.id)) return err('Invalid grant id');
    if (String(g.owner) !== addr) return err('Grant owner must be the signed-in wallet');
    const budget = toMicro(g.budget), perCall = toMicro(g.perCall), daily = toMicro(g.daily);
    if (!budget || !perCall || !daily) return err('Limits must be positive USDC amounts (max 6 decimals)');
    if (perCall > daily || daily > budget) return err('Per call ≤ daily ≤ budget');
    const exp = Date.parse(g.expires), iss = Date.parse(g.issued);
    if (!exp || !iss || new Date(exp).toISOString() !== g.expires || new Date(iss).toISOString() !== g.issued) return err('Invalid dates');
    if (Math.abs(Date.now() - iss) > 10 * 60 * 1000) return err('Grant signature expired. Sign again.');
    if (exp <= Date.now() + 60000 || exp > Date.now() + 366 * 86400000) return err('Expiry must be within one year');
    if (!isB64(b.encName, 400) || !isB64(b.wrappedKey, 200)) return err('Invalid sealed fields');
    if (!/^[0-9a-f]{64}$/.test(String(b.tokenHash || ''))) return err('Invalid key hash');
    const allow = Array.isArray(b.allow) ? b.allow.map(String) : [];
    if (allow.length > MAX_ALLOW || !allow.every(t => /^[0-9a-f]{64}$/.test(t)) || new Set(allow).size !== allow.length) return err(`Allowlist: up to ${MAX_ALLOW} sellers`);
    if (allow.length && !isB64(b.encAllow, 6000)) return err('Invalid sealed allowlist');
    const allowHash = allow.length ? await sha256hex([...allow].sort().join(',')) : '';
    if (String(g.allowHash || '') !== allowHash) return err('Allowlist commitment does not match');
    const clean = { id: g.id, owner: addr, budget: fromMicro(budget), perCall: fromMicro(perCall), daily: fromMicro(daily), expires: g.expires, issued: g.issued };
    if (allowHash) clean.allowHash = allowHash;
    if (g.approveAbove) { const v = toMicro(g.approveAbove); if (!v || v >= perCall) return err('Ask-above must be below the per-call limit'); clean.approveAbove = fromMicro(v); if (clean.approveAbove !== g.approveAbove) return err('Amounts must be written in canonical form'); }
    if (g.sellerDaily) { const v = toMicro(g.sellerDaily); if (!v || v > daily) return err('Per-seller cap must be at most the daily limit'); clean.sellerDaily = fromMicro(v); if (clean.sellerDaily !== g.sellerDaily) return err('Amounts must be written in canonical form'); }
    if (clean.budget !== g.budget || clean.perCall !== g.perCall || clean.daily !== g.daily) return err('Amounts must be written in canonical form');
    let signer;
    try { signer = DUSK_ECC.recoverAddress(grantMessage(clean), String(b.signature || '')); }
    catch { return err('Invalid signature'); }
    if (signer !== addr) return err('Signature does not match this wallet', 401);
    if (await env.DB.get(`g:${g.id}`)) return err('Grant id already used');
    const o = await getJSON(env, `o:${addr}`, { grants: [], check: null });
    if (o.grants.length >= MAX_GRANTS) return err(`Limit of ${MAX_GRANTS} grants per wallet`);
    let tier; try { tier = await tierOf(env, addr); } catch { return err('Could not read your $DUSK balance on Robinhood Chain. Try again.', 503); }
    if (allow.length && !tier.holder) return err(`Private allowlists are for $DUSK holders (${Number(tier.min).toLocaleString('en-US')}+ in this wallet).`, 403);
    const active = (await Promise.all(o.grants.map(id => getJSON(env, `g:${id}`)))).filter(x => x && x.status !== 'revoked').length;
    if (active >= tier.grants) return err(tier.holder ? `Limit of ${tier.grants} active grants. Revoke one first.` : `Free vaults hold ${FREE_GRANTS} active grants. Hold ${Number(tier.min).toLocaleString('en-US')} $DUSK for ${HOLDER_GRANTS}.`, 403);
    const genesis = await sha256hex(`dusk:${g.id}:${String(b.signature).toLowerCase()}`);
    const grant = {
      ...clean, signature: String(b.signature).toLowerCase(), status: 'active',
      encName: b.encName, wrappedKey: b.wrappedKey, tokenHash: b.tokenHash, allow, encAllow: allow.length ? b.encAllow : '', anchors: [],
      spentMicro: 0, day: dayKey(Date.now()), daySpentMicro: 0, count: 0, head: genesis, genesis, lastAt: null,
    };
    await putJSON(env, `g:${g.id}`, grant);
    o.grants.unshift(g.id);
    await putJSON(env, `o:${addr}`, o);
    await bumpStats(env, { grants: 1 });
    await pushFeed(env, { t: new Date().toISOString(), k: 'grant' });
    return json({ ok: true, grant: ownerGrant(grant) });
  }

  let mm;
  // Emergency stop: pause (or resume) every grant of this vault at once.
  if (p === '/api/vault/status' && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const b = await readBody(req);
    const to = String(b.status || ''), from = to === 'paused' ? 'active' : to === 'active' ? 'paused' : '';
    if (!from) return err('Invalid status');
    const o = await getJSON(env, `o:${addr}`, { grants: [] });
    let changed = 0;
    for (const id of o.grants) {
      const g = await getJSON(env, `g:${id}`);
      if (!g || g.owner !== addr || g.status !== from) continue;
      g.status = to; await putJSON(env, `g:${g.id}`, g); changed++;
    }
    return json({ ok: true, changed, status: to });
  }

  // Owner approves or declines a payment waiting above the ask-above amount.
  if ((mm = p.match(/^\/api\/grants\/([A-Za-z0-9_-]{16,32})\/requests\/([A-Za-z0-9_-]{8,32})$/)) && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g || g.owner !== addr) return err('Grant not found', 404);
    const b = await readBody(req);
    const d = String(b.decision || '');
    if (!['approve', 'decline'].includes(d)) return err('Invalid decision');
    const [res, code] = await decideRequest(env, g, mm[2], d, Date.now());
    return json(res, code);
  }

  // New agent key: same grant, same limits and ledger. The old key stops working at once.
  if ((mm = p.match(/^\/api\/grants\/([A-Za-z0-9_-]{16,32})\/rotate$/)) && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g || g.owner !== addr) return err('Grant not found', 404);
    if (g.status === 'revoked') return err('A revoked grant cannot get a new key');
    const b = await readBody(req);
    if (!/^[0-9a-f]{64}$/.test(String(b.tokenHash || ''))) return err('Invalid key hash');
    if (b.tokenHash === g.tokenHash) return err('This is the current key');
    g.tokenHash = b.tokenHash; g.rotatedAt = new Date().toISOString(); g.rotations = (g.rotations || 0) + 1;
    await putJSON(env, `g:${g.id}`, g);
    return json({ ok: true, grant: ownerGrant(g) });
  }

  if ((mm = p.match(/^\/api\/grants\/([A-Za-z0-9_-]{16,32})\/status$/)) && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g || g.owner !== addr) return err('Grant not found', 404);
    const b = await readBody(req);
    const status = String(b.status || '');
    if (!['active', 'paused', 'revoked'].includes(status)) return err('Invalid status');
    if (g.status === 'revoked') return err('A revoked grant cannot be changed');
    g.status = status;
    await putJSON(env, `g:${g.id}`, g);
    return json({ ok: true, grant: ownerGrant(g) });
  }

  if ((mm = p.match(/^\/api\/grants\/([A-Za-z0-9_-]{16,32})\/anchor$/)) && m === 'POST') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g || g.owner !== addr) return err('Grant not found', 404);
    if (!(await rateLimit(env, `anchor:${addr}`, 10))) return err('Slow down. Try again in a minute.', 429);
    let tier; try { tier = await tierOf(env, addr); } catch { return err('Could not read your $DUSK balance on Robinhood Chain. Try again.', 503); }
    if (!tier.holder) return err(`On-chain anchors are for $DUSK holders (${Number(tier.min).toLocaleString('en-US')}+ in this wallet).`, 403);
    const b = await readBody(req);
    const tx = String(b.tx || '').toLowerCase(), count = Number(b.count);
    if (!/^0x[0-9a-f]{64}$/.test(tx)) return err('Invalid transaction hash');
    if (!Number.isInteger(count) || count < 0 || count > g.count) return err('Invalid ledger position');
    g.anchors = g.anchors || [];
    if (g.anchors.some(a => a.tx === tx)) return err('This anchor is already recorded');
    if (g.anchors.length >= MAX_ANCHORS) return err(`Limit of ${MAX_ANCHORS} anchors per grant`);
    const head = count === 0 ? g.genesis : count === g.count ? g.head : await entryHash(env, g, count);
    if (!head) return err('Ledger entry not found');
    let t = null;
    for (let i = 0; i < 8 && !t; i++) { t = await rpc(env, 'eth_getTransactionByHash', [tx]).catch(() => null); if (!t) await new Promise(r => setTimeout(r, 800)); }
    if (!t) return err('Transaction not found on Robinhood Chain yet. Try again in a few seconds.', 404);
    if (String(t.from || '').toLowerCase() !== addr || String(t.to || '').toLowerCase() !== addr || String(t.input || '').toLowerCase() !== anchorData(g.id, count, head)) return err('This transaction is not a DUSK anchor for this grant');
    g.anchors.unshift({ tx, count, head, t: new Date().toISOString() });
    await putJSON(env, `g:${g.id}`, g);
    return json({ ok: true, anchors: g.anchors });
  }

  if ((mm = p.match(/^\/api\/grants\/([A-Za-z0-9_-]{16,32})\/ledger$/)) && m === 'GET') {
    const addr = await sessionAddress(req, env);
    if (!addr) return err('Session expired. Unlock again.', 401);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g || g.owner !== addr) return err('Grant not found', 404);
    const pages = Math.ceil(g.count / PAGE);
    const want = Math.min(pages, 3);
    const lists = await Promise.all(Array.from({ length: want }, (_, i) => getJSON(env, `l:${g.id}:${pages - 1 - i}`, [])));
    const entries = lists.flat().sort((a, b) => b.n - a.n);
    return json({ ok: true, genesis: g.genesis, head: g.head, count: g.count, entries });
  }

  if ((mm = p.match(/^\/api\/proof\/([A-Za-z0-9_-]{16,32})$/)) && m === 'GET') {
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g) return err('No grant with this id', 404);
    let holder = false; try { const t = await tierOf(env, g.owner); holder = !!(t.gated && t.holder); } catch {}
    return json({ ok: true, grant: publicGrant(g), message: grantMessage(g), holder }, 200, CORS);
  }

  // Seller check: is this agent bound by a live, signed DUSK grant?
  if ((mm = p.match(/^\/api\/verify\/([A-Za-z0-9_-]{16,32})$/)) && m === 'GET') {
    const ip = req.headers.get('cf-connecting-ip') || 'anon';
    if (!(await rateLimit(env, `verify:${ip}`, 60))) return err('Rate limit: 60 checks per minute', 429);
    const g = await getJSON(env, `g:${mm[1]}`);
    if (!g) return err('No DUSK grant with this id', 404);
    const now = Date.now();
    let signature = false; try { signature = DUSK_ECC.recoverAddress(grantMessage(g), String(g.signature || '')) === g.owner; } catch {}
    const active = g.status === 'active', notExpired = Date.parse(g.expires) > now;
    let holder = false; try { const t = await tierOf(env, g.owner); holder = !!(t.gated && t.holder); } catch {}
    const out = {
      ok: true, verified: signature && active && notExpired,
      grant: g.id, owner: g.owner, status: g.status, expires: g.expires, holder,
      checks: { signature, active, notExpired },
      limits: { budget: g.budget, perCall: g.perCall, daily: g.daily, approveAbove: g.approveAbove || null, sellerDaily: g.sellerDaily || null, allowlist: !!(g.allow && g.allow.length) },
      proof: `${url.origin}/#proof/${g.id}`,
    };
    const qa = url.searchParams.get('amount');
    if (qa !== null && qa !== '') {
      const amt = toMicro(qa.trim());
      if (!amt) return err('amount must be a positive USDC string, e.g. "0.05"');
      const reason = coverError(g, amt, now);
      const needsOwner = !reason && !!g.approveAbove && amt > toMicro(g.approveAbove);
      out.amount = { value: fromMicro(amt), covers: !reason && !needsOwner, needsOwner, reason: reason || (needsOwner ? `Above ${g.approveAbove} USDC the owner approves first` : '') };
    }
    const qr = (url.searchParams.get('receipt') || '').trim();
    if (qr) {
      const [ns, hh] = qr.split('.'), n = parseInt(ns, 10);
      let valid = false, e = null;
      if (n >= 1 && n <= g.count && /^[0-9a-f]{64}$/.test(hh || '')) {
        const page = await getJSON(env, `l:${g.id}:${Math.floor((n - 1) / PAGE)}`, []);
        e = page.find(x => x.n === n); valid = !!(e && e.hash === hh);
      }
      out.receipt = valid ? { valid: true, n, amount: e.amount, t: e.t } : { valid: false };
    }
    return json(out, 200, CORS);
  }

  // Agent endpoints
  if (p === '/api/agent' || p === '/api/spend' || p === '/api/check' || p.startsWith('/api/spend/')) {
    const h = req.headers.get('authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const parts = t.split('.');
    if (parts.length !== 2 || !isId(parts[0]) || !/^[A-Za-z0-9_-]{20,64}$/.test(parts[1])) return err('Missing or invalid agent key', 401);
    const g = await getJSON(env, `g:${parts[0]}`);
    if (!g || g.tokenHash !== (await sha256hex(parts[1]))) return err('Missing or invalid agent key', 401);
    const now = Date.now(), today = dayKey(now);
    const daySpent = g.day === today ? g.daySpentMicro : 0;
    const budget = toMicro(g.budget), perCall = toMicro(g.perCall), daily = toMicro(g.daily);
    const view = () => ({
      grant: g.id, status: g.status, expires: g.expires,
      budget: g.budget, perCall: g.perCall, daily: g.daily,
      spent: fromMicro(g.spentMicro), remaining: fromMicro(Math.max(0, budget - g.spentMicro)),
      remainingToday: fromMicro(Math.max(0, daily - (g.day === dayKey(Date.now()) ? g.daySpentMicro : 0))),
      allowlist: (g.allow || []).length,
      approveAbove: g.approveAbove || null, sellerDaily: g.sellerDaily || null,
      forecast: forecast(g),
    });

    if (p === '/api/agent' && m === 'GET') return json({ ok: true, ...view() }, 200, CORS);

    // Dry run: same checks as /api/spend, nothing is spent or recorded.
    if (p === '/api/check' && m === 'POST') {
      if (!(await rateLimit(env, `check:${g.id}`, 120))) return err('Rate limit: 120 checks per minute', 429);
      const b = await readBody(req, 2000);
      const amt = toMicro(String(b.amount ?? ''));
      if (!amt) return err('amount must be a positive USDC string, e.g. "0.0025"');
      const tag = b.tag === undefined || b.tag === null ? '' : String(b.tag);
      if (tag && !/^[0-9a-f]{64}$/.test(tag)) return err('tag must be 64 hex characters');
      const le = limitError(g, amt, tag, now);
      if (le) return err(le[0], le[1]);
      if (g.approveAbove && amt > toMicro(g.approveAbove)) return json({ ok: false, pending: true, error: `Needs the owner's approval (above ${g.approveAbove} USDC)` }, 202, CORS);
      return json({ ok: true, pass: true, amount: fromMicro(amt), ...view() }, 200, CORS);
    }
    if (p === '/api/spend' && m === 'POST') {
      if (!(await rateLimit(env, `spend:${g.id}`, 120))) return err('Rate limit: 120 payments per minute', 429);
      const b = await readBody(req, 12000);
      const amt = toMicro(String(b.amount ?? ''));
      if (!amt) return err('amount must be a positive USDC string, e.g. "0.0025"');
      if (!isB64(b.sealed, 8000)) return err('sealed must be base64 ciphertext (max 8 KB)');
      const tag = b.tag === undefined || b.tag === null ? '' : String(b.tag);
      if (tag && !/^[0-9a-f]{64}$/.test(tag)) return err('tag must be 64 hex characters');
      const le = limitError(g, amt, tag, now);
      if (le) return err(le[0], le[1]);
      if (g.approveAbove && amt > toMicro(g.approveAbove)) {
        g.pending = (g.pending || []).filter(x => x.status === 'pending' ? Date.parse(x.exp) > now - 86400e3 : Date.parse(x.t) > now - 86400e3).slice(-40);
        if (g.pending.filter(x => x.status === 'pending' && Date.parse(x.exp) > now).length >= 10) return err('Too many payments waiting for the owner', 429);
        const rid = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12)))).replace(/\+/g, '-').replace(/\//g, '_');
        const exp = new Date(now + 30 * 60e3).toISOString();
        g.pending.push({ id: rid, t: new Date(now).toISOString(), amount: fromMicro(amt), sealed: b.sealed, tag, status: 'pending', exp });
        await putJSON(env, `g:${g.id}`, g);
        return json({ ok: false, pending: true, request: rid, expires: exp, error: `Waiting for the owner's approval (above ${g.approveAbove} USDC)` }, 202, CORS);
      }
      const receipt = await recordPayment(env, g, amt, b.sealed, tag, now);
      return json({ ok: true, receipt, ...view() }, 200, CORS);
    }
    if (p.startsWith('/api/spend/') && m === 'GET') {
      const rid = p.slice(11), it = (g.pending || []).find(x => x.id === rid);
      if (!it) return err('No such request', 404);
      const st = it.status === 'pending' && Date.parse(it.exp) <= now ? 'expired' : it.status;
      return json({ ok: true, request: rid, status: st, amount: it.amount, receipt: it.receipt || null, reason: it.reason || '' }, 200, CORS);
    }
    return err('Method not allowed', 405);
  }

  return err('Not found', 404);
}

/* ---------- Agent 01: a public demo agent ----------
   Runs on its own throwaway wallet, created by the Worker. Demo sellers, no real money moves.
   Its grant is real and verifiable on the Proof page. It never counts in the public stats. */
const A1 = { budget: '30', perCall: '0.1', daily: '1', days: 30, approveAbove: '0.08', sellerDaily: '0.4' };
const A1_RESEARCH = ['search.demo', 'newswire.demo', 'llm.demo'];
const A1_JOBS = [
  ['newswire.demo', 'GET /headlines?q=robinhood-chain', 'morning news scan', 0.004, 0.02],
  ['fx.demo', 'GET /rates?base=USD', 'rates for the daily report', 0.001, 0.006],
  ['search.demo', 'POST /search "tokenized stocks volume"', 'market research', 0.01, 0.05],
  ['search.demo', 'POST /search "AI agents payments"', 'topic research', 0.01, 0.05],
  ['llm.demo', 'POST /v1/chat summary, 2k tokens', 'summarize findings', 0.02, 0.09],
  ['llm.demo', 'POST /v1/chat full report, 14k tokens', 'weekly report draft', 0.07, 0.16],
  ['ocr.demo', 'POST /scan filing.pdf', 'read a company filing', 0.03, 0.13],
  ['prices.demo', 'GET /quote?symbols=8', 'price check', 0.002, 0.01],
  ['translate.demo', 'POST /translate 3 pages', 'translate a source', 0.01, 0.04],
  ['vision.demo', 'POST /describe chart.png', 'read a chart', 0.02, 0.11],
];
const a1b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function a1Addr(d) {
  const E = DUSK_ECC, Q = E._affine(E._mulAdd(d, E._G, 0n, E._G)), pub = new Uint8Array(64);
  pub.set(E.bigTo32(Q[0])); pub.set(E.bigTo32(Q[1]), 32);
  return '0x' + E.bytesToHex(E.keccak256(pub).slice(12));
}
function a1Sign(d, text) {
  const E = DUSK_ECC, N = E._N, e = E._mod(E.bytesToBig(E.hashMessage(text)), N);
  for (;;) {
    const k = E._mod(E.bytesToBig(crypto.getRandomValues(new Uint8Array(32))), N); if (!k) continue;
    const P = E._affine(E._mulAdd(k, E._G, 0n, E._G)), r = E._mod(P[0], N); if (!r) continue;
    let s = E._mod(E._inv(k, N) * (e + r * d), N); if (!s) continue;
    let v = Number(P[1] & 1n); if (s > N / 2n) { s = N - s; v ^= 1; }
    return '0x' + E.bytesToHex(E.bigTo32(r)) + E.bytesToHex(E.bigTo32(s)) + (27 + v).toString(16);
  }
}
async function a1State(env) {
  let st = await getJSON(env, 'a1:state');
  if (st) {
    const g = await getJSON(env, `g:${st.id}`);
    if (g && g.status === 'active' && g.approveAbove === A1.approveAbove && Date.parse(g.expires) > Date.now() + 3600e3) return st;
    if (g && g.status !== 'revoked') { g.status = 'revoked'; await putJSON(env, `g:${g.id}`, g); }
  }
  const E = DUSK_ECC;
  let d = 0n; while (!d) d = E._mod(E.bytesToBig(crypto.getRandomValues(new Uint8Array(32))), E._N);
  const owner = a1Addr(d), now = Date.now();
  const id = a1b64url(crypto.getRandomValues(new Uint8Array(15))), token = a1b64url(crypto.getRandomValues(new Uint8Array(24))), sk = crypto.getRandomValues(new Uint8Array(32));
  const clean = { id, owner, budget: A1.budget, perCall: A1.perCall, daily: A1.daily, expires: new Date(now + A1.days * 86400e3).toISOString(), issued: new Date(now).toISOString(), approveAbove: A1.approveAbove, sellerDaily: A1.sellerDaily };
  const signature = a1Sign(d, grantMessage(clean)).toLowerCase();
  if (DUSK_ECC.recoverAddress(grantMessage(clean), signature) !== owner) throw new Error('agent01 signature');
  const genesis = await sha256hex(`dusk:${id}:${signature}`);
  await putJSON(env, `g:${id}`, { ...clean, signature, status: 'active', demo: true, encName: '', wrappedKey: '', tokenHash: await sha256hex(token), allow: [], encAllow: '', anchors: [], spentMicro: 0, day: dayKey(now), daySpentMicro: 0, count: 0, head: genesis, genesis, lastAt: null });
  st = { id, token, sk: a1b64url(sk), owner, run: (st && st.run || 0) + 1 };
  await putJSON(env, 'a1:state', st);
  return st;
}
async function a1Tick(env) {
  const st = await a1State(env);
  const log = await getJSON(env, 'a1:log', { totals: { asked: 0, approved: 0, refused: 0 }, items: [] });
  const raw = Uint8Array.from(atob(st.sk.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const hkey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  // The demo owner is a script too: it approves research spending and declines the rest.
  const g0 = await getJSON(env, `g:${st.id}`);
  for (const it of (g0 && g0.pending || []).filter(x => x.status === 'pending')) {
    const yes = A1_RESEARCH.includes(it.seller || '');
    const g = await getJSON(env, `g:${st.id}`);
    const [res] = await decideRequest(env, g, it.id, yes ? 'approve' : 'decline', Date.now());
    const li = log.items.find(x => x.request_id === it.id);
    if (li) { li.decision = res.status || 'declined'; li.reason = res.ok ? (yes ? 'Approved by the owner' : 'Declined by the owner') : res.error; li.ok = res.status === 'approved'; if (res.receipt) li.n = res.receipt.n; li.decidedAt = new Date().toISOString(); }
    if (res.status === 'approved') { log.totals.approved++; log.totals.waiting = Math.max(0, (log.totals.waiting || 0) - 1); }
    else { log.totals.refused++; log.totals.waiting = Math.max(0, (log.totals.waiting || 0) - 1); }
  }
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const [seller, request, note, lo, hi] = A1_JOBS[Math.floor(Math.random() * A1_JOBS.length)];
    const amount = fromMicro(Math.max(1000, Math.round((lo + Math.random() * (hi - lo)) * MICRO / 1000) * 1000));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ seller, request, note }))));
    const sealed = btoa(String.fromCharCode(...iv, ...ct));
    const tag = [...new Uint8Array(await crypto.subtle.sign('HMAC', hkey, new TextEncoder().encode(seller)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const req = new Request('https://duskdot.fun/api/spend', { method: 'POST', headers: { authorization: `Bearer ${st.id}.${st.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ amount, sealed, tag }) });
    let r; try { r = await (await api(req, env, new URL(req.url))).json(); } catch (e) { r = { ok: false, error: 'DUSK unreachable' }; }
    log.totals.asked++;
    if (r.pending) {
      log.totals.waiting = (log.totals.waiting || 0) + 1;
      const g = await getJSON(env, `g:${st.id}`); const it = (g.pending || []).find(x => x.id === r.request); if (it) { it.seller = seller; await putJSON(env, `g:${g.id}`, g); }
      log.items.unshift({ t: new Date().toISOString(), seller, request, note, amount, ok: false, pending: true, request_id: r.request, reason: r.error, n: null });
    } else {
      r.ok ? log.totals.approved++ : log.totals.refused++;
      log.items.unshift({ t: new Date().toISOString(), seller, request, note, amount, ok: !!r.ok, reason: r.ok ? '' : r.error, n: r.ok ? r.receipt.n : null });
    }
  }
  log.items = log.items.slice(0, 300); log.lastRun = new Date().toISOString(); log.grant = st.id;
  await putJSON(env, 'a1:log', log);
  return log;
}
async function a1Public(env) {
  let log = await getJSON(env, 'a1:log');
  if (!log) log = await a1Tick(env);
  const g = await getJSON(env, `g:${log.grant}`);
  const today = dayKey(Date.now());
  return json({
    ok: true, demo: true,
    grant: g ? { id: g.id, owner: g.owner, status: g.status, budget: g.budget, perCall: g.perCall, daily: g.daily, approveAbove: g.approveAbove || null, sellerDaily: g.sellerDaily || null, expires: g.expires, spent: fromMicro(g.spentMicro), spentToday: fromMicro(g.day === today ? g.daySpentMicro : 0), count: g.count, forecast: forecast(g) } : null,
    totals: log.totals, lastRun: log.lastRun, items: log.items.slice(0, 120),
  }, 200, CORS);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return e && e.status ? err(e.message, e.status) : err('Server error', 500); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(a1Tick(env).catch(() => {}));
  },
};
