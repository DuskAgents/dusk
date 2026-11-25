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

async function rpc(env, method, params) {
  const r = await fetch(env.RPC_URL || RPC_DEFAULT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
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
  };
}

async function readBody(req, max = 16384) {
  const t = await req.text();
  if (t.length > max) throw Object.assign(new Error('Request too large'), { status: 413 });
  try { return JSON.parse(t) || {}; } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
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
  if (p === '/api/tier' && m === 'GET') {
    const { ca, min } = await tierInfo(env);
    return json({ ok: true, gated: !!ca, min, freeGrants: FREE_GRANTS, holderGrants: HOLDER_GRANTS });
  }
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
    return json({ ok: true, grant: publicGrant(g), message: grantMessage(g) }, 200, CORS);
  }

  // Agent endpoints
  if (p === '/api/agent' || p === '/api/spend') {
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
    });

    if (p === '/api/agent' && m === 'GET') return json({ ok: true, ...view() }, 200, CORS);

    if (p === '/api/spend' && m === 'POST') {
      if (!(await rateLimit(env, `spend:${g.id}`, 120))) return err('Rate limit: 120 payments per minute', 429);
      const b = await readBody(req, 12000);
      const amt = toMicro(String(b.amount ?? ''));
      if (!amt) return err('amount must be a positive USDC string, e.g. "0.0025"');
      if (!isB64(b.sealed, 8000)) return err('sealed must be base64 ciphertext (max 8 KB)');
      const tag = b.tag === undefined || b.tag === null ? '' : String(b.tag);
      if (tag && !/^[0-9a-f]{64}$/.test(tag)) return err('tag must be 64 hex characters');
      if (g.status !== 'active') return err(`Grant is ${g.status}`, 403);
      if (Date.parse(g.expires) <= now) return err('Grant expired', 403);
      if (g.allow && g.allow.length && !g.allow.includes(tag)) return err("Seller is not on this grant's private allowlist", 403);
      if (amt > perCall) return err(`Over per-call limit (${g.perCall} USDC)`, 402);
      if (daySpent + amt > daily) return err(`Over daily limit (${g.daily} USDC)`, 402);
      if (g.spentMicro + amt > budget) return err(`Over budget (${fromMicro(Math.max(0, budget - g.spentMicro))} USDC left)`, 402);
      const n = g.count + 1, ts = new Date(now).toISOString(), amount = fromMicro(amt);
      const hash = await sha256hex(`${g.head}|${n}|${ts}|${amount}|${b.sealed}`);
      const entry = { n, t: ts, amount, sealed: b.sealed, prev: g.head, hash };
      const pageKey = `l:${g.id}:${Math.floor((n - 1) / PAGE)}`;
      const page = await getJSON(env, pageKey, []);
      page.push(entry);
      await putJSON(env, pageKey, page);
      g.count = n; g.head = hash; g.spentMicro += amt; g.day = today; g.daySpentMicro = daySpent + amt; g.lastAt = ts;
      await putJSON(env, `g:${g.id}`, g);
      await bumpStats(env, { payments: 1, volume: amt });
      await pushFeed(env, { t: ts, k: 'pay' });
      return json({ ok: true, receipt: { grant: g.id, n, t: ts, amount, prev: entry.prev, hash }, ...view() }, 200, CORS);
    }
    return err('Method not allowed', 405);
  }

  return err('Not found', 404);
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
};
