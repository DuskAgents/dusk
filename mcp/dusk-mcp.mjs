#!/usr/bin/env node
// DUSK MCP server. No dependencies, Node 18+.
// Gives any MCP-capable agent (Claude Desktop, Claude Code, Cursor and others) three tools:
//   dusk_limits  read the grant's live limits
//   dusk_check   dry run: would this payment pass? Nothing is spent or recorded.
//   dusk_spend   ask DUSK before paying a seller. Pay only when the answer is ok.
//
// Config: DUSK_AGENT_KEY=<grantId>.<token>.<sealingKey>   (required)
//         DUSK_URL=https://duskdot.fun                     (optional)

import { createDusk } from '../client/dusk-agent.mjs';

const SERVER = { name: 'dusk', version: '2.0.0' };
const PROTOCOL = '2025-06-18';

let dusk = null, keyError = '';
try { dusk = createDusk(process.env.DUSK_AGENT_KEY, { url: process.env.DUSK_URL || 'https://duskdot.fun' }); }
catch (e) { keyError = e.message; }

const amount = { type: 'string', description: 'USDC amount as a decimal string, e.g. "0.0025"' };
const seller = { type: 'string', description: 'Seller URL or host, e.g. "api.vendor.dev/search"' };
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
    return r.ok
      ? text(`Approved. Pay ${r.receipt.amount} USDC to the seller now. Receipt #${r.receipt.n}, ${r.remainingToday} USDC left today.`)
      : text(`Refused: ${r.error}. Do not pay this seller.`, true);
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return { protocolVersion: params && params.protocolVersion ? params.protocolVersion : PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
      instructions: 'Before paying any seller, call dusk_spend. Pay only when it says Approved.' };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') return { tools: TOOLS };
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
