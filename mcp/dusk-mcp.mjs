#!/usr/bin/env node
// DUSK MCP server. No dependencies, Node 18+.
// Gives any MCP-capable agent (Claude Desktop, Claude Code, Cursor and others) three tools:
//   dusk_limits  read the grant's live limits
//   dusk_check   dry run: would this payment pass? Nothing is spent or recorded.
//   dusk_spend   ask DUSK before paying a seller. Pay only when the answer is ok.
//   dusk_status  follow a payment waiting for the owner's approval.
//
//
// V4, on-chain: the agent pays sellers straight from its DUSK vault on Robinhood Chain.
//   dusk_vault          the vault's live limits and what is left
//   dusk_vault_check    would this payment go through right now?
//   dusk_vault_pay      pay a seller from the vault, inside the owner's limits
//
// Config (grants):  DUSK_AGENT_KEY=<grantId>.<token>.<sealingKey>
// Config (V4):      DUSK_AGENT_WALLET_KEY=<agent wallet key>  DUSK_VAULT_ID=<vault number>
// Set either one, or both.            DUSK_URL=https://duskdot.fun (optional)

import { createDusk } from '../client/dusk-agent.mjs';
import { createVault } from '../client/dusk-vault.mjs';

const SERVER = { name: 'dusk', version: '3.0.0' };
const PROTOCOL = '2025-06-18';

let dusk = null, keyError = '', vault = null, vaultError = '';
if (process.env.DUSK_AGENT_KEY) {
  try { dusk = createDusk(process.env.DUSK_AGENT_KEY, { url: process.env.DUSK_URL || 'https://duskdot.fun' }); }
  catch (e) { keyError = e.message; }
} else keyError = 'set DUSK_AGENT_KEY';
if (process.env.DUSK_AGENT_WALLET_KEY || process.env.DUSK_VAULT_ID) {
  try { vault = createVault({ key: process.env.DUSK_AGENT_WALLET_KEY, vault: process.env.DUSK_VAULT_ID }); }
  catch (e) { vaultError = e.message; }
} else vaultError = 'set DUSK_AGENT_WALLET_KEY and DUSK_VAULT_ID';

const amount = { type: 'string', description: 'USDC amount as a decimal string, e.g. "0.0025"' };
const seller = { type: 'string', description: 'Seller URL or host, e.g. "api.vendor.dev/search"' };
const wallet = { type: 'string', description: 'Seller wallet address, 0x…' };
const tokenAmount = { type: 'string', description: 'Amount in the vault token, as a decimal string, e.g. "0.05"' };
const VAULT_TOOLS = [
  {
    name: 'dusk_vault',
    description: "Read this agent's DUSK vault on Robinhood Chain: status, what is left, spent today, per-payment and daily limits, expiry.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dusk_vault_check',
    description: 'Ask the vault contract whether a payment would go through right now. Free, nothing is sent.',
    inputSchema: { type: 'object', properties: { seller: wallet, amount: tokenAmount }, required: ['seller', 'amount'], additionalProperties: false },
  },
  {
    name: 'dusk_vault_pay',
    description: "Pay a seller from the vault. The contract enforces the owner's limits: inside them the seller is paid in the same transaction, above the owner's ask-me amount the payment waits for the owner, anything else is refused and nothing moves. Give the returned transaction hash to the seller.",
    inputSchema: { type: 'object', properties: { seller: wallet, amount: tokenAmount, memo: { type: 'string', description: 'Short note stored on-chain, max 32 bytes' } }, required: ['seller', 'amount'], additionalProperties: false },
  },
];
const TOOLS = [
  {
    name: 'dusk_limits',
    description: 'Read the live limits of this DUSK grant: status, budget left, left today, max per call, expiry.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dusk_check',
    description: 'Dry run. Ask DUSK whether a payment would be approved, without spending or recording anything.',
    inputSchema: { type: 'object', properties: { amount, seller }, required: ['amount'], additionalProperties: false },
  },
  {
    name: 'dusk_status',
    description: 'Check a payment that is waiting for the owner. Pay only when the status is approved.',
    inputSchema: { type: 'object', properties: { request: { type: 'string', description: 'The request id returned by dusk_spend' } }, required: ['request'], additionalProperties: false },
  },
  {
    name: 'dusk_spend',
    description: 'Call this before every payment to a seller. If the result is approved, pay the seller from your own wallet. If it is refused, do not pay. The seller, request and note are sealed before they leave this machine.',
    inputSchema: {
      type: 'object',
      properties: {
        amount, seller,
        request: { type: 'string', description: 'What is being bought (sealed, only the owner can read it)' },
        note: { type: 'string', description: 'Optional note for the owner (sealed)' },
      },
      required: ['amount', 'seller'],
      additionalProperties: false,
    },
  },
];

function text(obj, isError = false) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }], isError };
}

async function callTool(name, args = {}) {
  if (name.startsWith('dusk_vault')) {
    if (!vault) return text(`DUSK vault is not configured: ${vaultError}.`, true);
    if (name === 'dusk_vault') { const r = await vault.status(); return r.ok ? text(r) : text(r.error, true); }
    if (name === 'dusk_vault_check') {
      const r = await vault.canPay(args.seller, args.amount);
      return text(r.ok ? 'Would go through now.' : r.waiting ? "Would wait for the owner's approval." : `Would be refused: ${r.reason}.`);
    }
    if (name === 'dusk_vault_pay') {
      const r = await vault.pay(args.seller, args.amount, args.memo || '');
      if (r.ok) return text(`Paid ${r.amount} to ${r.seller} from the vault. Transaction ${r.hash}. Give this hash to the seller.`);
      if (r.waiting) return text(`Waiting for the owner's approval (request ${r.request}). The seller is paid automatically once the owner approves. Transaction ${r.hash}.`);
      if (r.pending) return text(`Sent, not confirmed yet. Transaction ${r.hash}.`);
      return text(`Refused by the vault: ${r.reason}. Nothing moved.`, true);
    }
  }
  if (!dusk) return text(`DUSK is not configured: ${keyError || 'set DUSK_AGENT_KEY'}.`, true);
  if (name === 'dusk_limits') {
    const r = await dusk.limits();
    return r.ok ? text(r) : text(`Refused: ${r.error}`, true);
  }
  if (name === 'dusk_check') {
    const r = await dusk.check({ amount: args.amount, seller: args.seller || '' });
    return r.ok ? text(`Would be approved. ${r.remainingToday} USDC left today, ${r.remaining} USDC left in total.`) : text(`Would be refused: ${r.error}`);
  }
  if (name === 'dusk_spend') {
    const r = await dusk.spend({ amount: args.amount, seller: args.seller, request: args.request || '', note: args.note || '' });
    if (r.pending) return text(`Waiting for the owner's approval. Do not pay yet. Call dusk_status with request "${r.request}" later.`);
    return r.ok
      ? text(`Approved. Pay ${r.receipt.amount} USDC to the seller now. Receipt #${r.receipt.n}, ${r.remainingToday} USDC left today.`)
      : text(`Refused: ${r.error}. Do not pay this seller.`, true);
  }
  if (name === 'dusk_status') {
    const r = await dusk.status(args.request);
    if (!r.ok) return text(`Unknown request: ${r.error}`, true);
    if (r.status === 'approved') return text(`Approved by the owner. Pay ${r.amount} USDC to the seller now. Receipt #${r.receipt.n}.`);
    if (r.status === 'pending') return text('Still waiting for the owner. Do not pay yet.');
    return text(`${r.status === 'expired' ? 'Expired' : 'Declined'}${r.reason ? `: ${r.reason}` : ''}. Do not pay this seller.`, true);
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return { protocolVersion: params && params.protocolVersion ? params.protocolVersion : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
      instructions: vault ? 'To pay a seller, call dusk_vault_pay. The vault contract enforces the owner\'s limits on-chain.' : 'Before paying any seller, call dusk_spend. Pay only when it says Approved.' };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: [...(dusk || !vault ? TOOLS : []), ...(vault || !dusk ? VAULT_TOOLS : [])] };
  if (method === 'tools/call') {
    try { return await callTool(params.name, params.arguments || {}); }
    catch (e) { if (e.code) throw e; return text(`DUSK could not be reached: ${e.message}`, true); }
  }
  if (id === undefined) return undefined; // notification
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

const send = m => process.stdout.write(JSON.stringify(m) + '\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    Promise.resolve(handle(msg)).then(result => {
      if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
    }).catch(e => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }); });
  }
});
