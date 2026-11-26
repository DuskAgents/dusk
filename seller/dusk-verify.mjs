// DUSK seller check: serve an AI agent only when its grant is live and signed.
// Node 18+, Deno, Bun, Cloudflare Workers. No dependencies.
//
// The agent sends two headers:
//   X-Dusk-Grant:   its grant id (public)
//   X-Dusk-Receipt: "<n>.<hash>" from the receipt DUSK returned when the payment was approved
//
// Usage:
//   import { duskVerify } from './dusk-verify.mjs';
//   const v = await duskVerify(request.headers, '0.05');
//   if (!v.ok) return new Response(v.error, { status: 402 });

export const DUSK = (typeof process !== "undefined" && process.env && process.env.DUSK_URL) || 'https://duskdot.fun';

export async function duskVerify(headers, price, base = DUSK) {
  const get = k => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
  const grant = get('x-dusk-grant');
  if (!grant) return { ok: false, error: 'No DUSK grant' };
  const receipt = get('x-dusk-receipt');
  const q = new URLSearchParams(receipt ? { receipt } : { amount: price });
  const r = await fetch(`${base}/api/verify/${encodeURIComponent(grant)}?${q}`).then(r => r.json());
  if (!r.ok || !r.verified) return { ok: false, error: r.error || 'Grant is not live' };
  if (receipt) {
    if (!r.receipt?.valid) return { ok: false, error: 'Receipt is not in the signed ledger' };
    if (Number(r.receipt.amount) < Number(price)) return { ok: false, error: 'Receipt is below your price' };
  } else if (!r.amount?.covers) {
    return { ok: false, error: r.amount?.reason || 'Not covered' };
  }
  return { ok: true, grant: r.grant, owner: r.owner, holder: r.holder };
}

// Headers your agent sends to a seller after DUSK approves a payment.
export const sellerHeaders = receipt => ({ 'x-dusk-grant': receipt.grant, 'x-dusk-receipt': `${receipt.n}.${receipt.hash}` });
