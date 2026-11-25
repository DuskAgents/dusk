// node examples/agent.mjs
// DUSK_AGENT_KEY=<grantId>.<token>.<sealingKey> [DUSK_URL=https://duskdot.fun]

import { createDusk } from '../client/dusk-agent.mjs';

const dusk = createDusk(process.env.DUSK_AGENT_KEY, { url: process.env.DUSK_URL || undefined });

console.log('limits', await dusk.limits());

const r = await dusk.spend({ amount: '0.01', seller: 'api.vendor.dev/search', request: 'lithium supply 2026' });
if (r.ok) {
  console.log('approved', r.receipt);
  // send the USDC payment to the seller from your agent wallet here
} else {
  console.log('refused', r.error);
}
