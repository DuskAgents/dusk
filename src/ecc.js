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
