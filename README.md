<p align="center"><img src="docs/banner.jpg" alt="DUSK" width="100%"></p>

<h1 align="center">DUSK</h1>
<p align="center"><b>Private spending for AI agents.</b><br>Spent in silence. Bound by proof.</p>
<p align="center"><a href="https://duskdot.fun">duskdot.fun</a> · <a href="https://x.com/DuskAgents">@DuskAgents</a> · Robinhood Chain</p>

---

AI agents pay for data, search, models and compute on their own. Every call is a payment, and every payment says something about what you are building. On-chain, anyone can follow that trail.

DUSK lets you hand an agent a spending key with hard limits, while what it buys stays sealed. DUSK never holds funds and never sees what your agent paid for.

<p align="center"><img src="docs/how.jpg" alt="How DUSK works" width="100%"></p>

## How it works

**Sign one grant.** Set a total budget, a cap per call, a cap per day and an expiry, then sign it with your wallet. A signature, not a transaction: no gas, no deposit.

**Hand your agent a key.** Your browser creates the agent key and a sealing key. DUSK only stores a SHA-256 hash of the key token. The sealing key never reaches DUSK.

**Your agent asks before it pays.** Inside the limits, approved. Over a cap, expired, paused or revoked, refused. The agent pays the seller from its own wallet.

**Every payment is sealed.** The agent encrypts the seller, the request and the note with AES-GCM before they reach DUSK. Each ledger entry carries the hash of the one before. Only your wallet can open the ledger.

**Proof, not promises.** Anyone can load a grant and recover the signer in their own browser.

**Private allowlists.** Each allowed seller becomes an HMAC tag keyed with your sealing key. DUSK enforces the list without ever learning a name.

**On-chain anchors.** Pin your ledger head on Robinhood Chain with a zero-value transaction to yourself. Once anchored, no one can rewrite the history, DUSK included.

**$DUSK holders.** Every vault gets 3 active grants. Holders get up to 50. The balance is read live on Robinhood Chain.

## For agents

```js
import { createDusk } from './client/dusk-agent.mjs';

const dusk = createDusk(process.env.DUSK_AGENT_KEY); // <grantId>.<token>.<sealingKey>

const r = await dusk.spend({ amount: '0.0025', seller: 'api.vendor.dev/search', request: 'lithium supply 2026' });
if (r.ok) {
  // pay the seller from your agent wallet
} else {
  console.log(r.error); // over per-call limit, over budget, paused, not on allowlist...
}
```

No dependencies. Runs on Node 18+, Deno, Bun, browsers and Workers. See [`examples/agent.mjs`](examples/agent.mjs).

## API

| Method | Route | Auth | |
|---|---|---|---|
| GET | `/api/stats` | none | grants, payments, owners, volume |
| GET | `/api/feed` | none | recent activity, no content |
| GET | `/api/tier` | none | holder threshold and grant limits |
| GET | `/api/ca` | none | $DUSK contract address |
| GET | `/api/proof/:id` | none | signed terms, status, ledger head, anchors |
| POST | `/api/login` | wallet signature | session |
| GET | `/api/vault` | session | your grants and tier |
| POST | `/api/grants` | session + grant signature | create a grant |
| POST | `/api/grants/:id/status` | session | pause, resume, revoke |
| GET | `/api/grants/:id/ledger` | session | sealed entries |
| POST | `/api/grants/:id/anchor` | session | record an on-chain anchor |
| GET | `/api/agent` | agent key | limits and status |
| POST | `/api/spend` | agent key | `{ amount, sealed, tag }` |

## Protocol

Signatures are EIP-191 `personal_sign`, recovered with secp256k1 in the Worker and in the page. Amounts are USDC with 6 decimals.

**Grant message**

```
DUSK grant
Grant: <id>
Owner: <address>
Budget: <amount> USDC
Per call: <amount> USDC
Daily: <amount> USDC
Allowlist: <sha256 of sorted tags joined by ",">   (only when set)
Expires: <ISO date>
Issued: <ISO date>
```

**Ledger**

```
genesis = sha256("dusk:" + grantId + ":" + signature)
entry_n = sha256(prev | n | timestamp | amount | sealed)
```

**Allowlist tag**

```
host = lowercase(seller) without scheme and path
tag  = hex(HMAC-SHA256(sealingKey, host))
```

**Anchor**

A zero-value transaction from the owner to itself on Robinhood Chain (chain id 4663), with data:

```
"DUSK anchor\n" + grantId + "\n" + count + "\n" + head
```

The Worker checks `from`, `to` and `input` with `eth_getTransactionByHash` before recording it.

## Run your own

```bash
npx wrangler kv namespace create DUSK_DB   # paste the id in wrangler.toml
python3 build.py                           # src/ -> worker.js + public/index.html
npx wrangler deploy
npx wrangler kv key put --binding=DB ca 0xYOUR_TOKEN --remote   # optional, enables holder tier
```

## Layout

```
src/ecc.js           keccak256 + secp256k1 recovery, shared by Worker and page
src/worker_body.js   API, limits, sealed ledger, anchors
src/index.src.html   the site
client/              drop-in agent client
worker.js, public/   built output
```

## License

MIT
