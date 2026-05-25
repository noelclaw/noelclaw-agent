#!/usr/bin/env node
// setup-wizard.js — noelclaw cross-platform interactive setup (Windows / macOS / Linux)
//
// Usage:
//   node setup-wizard.js                              — interactive setup
//   node setup-wizard.js --keypair KEY --address ADDR — called by: node agent.js init
'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const SCRIPT_DIR = __dirname;
const ENV_FILE   = path.join(SCRIPT_DIR, '.env');
const CFG_BASE   = path.join(SCRIPT_DIR, 'config', 'agent.json');
const CFG_LOCAL  = path.join(SCRIPT_DIR, 'config', 'agent.local.json');

// ── ANSI colours (disabled on Windows if not supported) ───────────────────────
const hasColour = process.stdout.isTTY && process.platform !== 'win32'
  || process.env.FORCE_COLOR;

const G  = s => hasColour ? `\x1b[0;32m${s}\x1b[0m`  : s;  // green
const BG = s => hasColour ? `\x1b[1;32m${s}\x1b[0m`  : s;  // bright green
const Y  = s => hasColour ? `\x1b[1;33m${s}\x1b[0m`  : s;  // yellow
const R  = s => hasColour ? `\x1b[0;31m${s}\x1b[0m`  : s;  // red
const C  = s => hasColour ? `\x1b[0;36m${s}\x1b[0m`  : s;  // cyan
const D  = s => hasColour ? `\x1b[2m${s}\x1b[0m`     : s;  // dim
const B  = s => hasColour ? `\x1b[1m${s}\x1b[0m`     : s;  // bold

// ── Helpers ───────────────────────────────────────────────────────────────────

function envGet(key) {
  try {
    const line = fs.readFileSync(ENV_FILE, 'utf8').split('\n')
      .find(l => l.startsWith(key + '='));
    return line ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}

function cfgGet(dotKey) {
  function dig(obj, keys) {
    try { return keys.reduce((o, k) => o[k], obj) ?? ''; } catch { return ''; }
  }
  const keys = dotKey.split('.');
  let val = '';
  try { val = dig(JSON.parse(fs.readFileSync(CFG_LOCAL, 'utf8')), keys); } catch {}
  if (!val) {
    try { val = dig(JSON.parse(fs.readFileSync(CFG_BASE,  'utf8')), keys); } catch {}
  }
  return val || '';
}

function ask(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function stepHeader(step, total, title) {
  console.log('');
  console.log(`  ${C(title)}  ${D('─'.repeat(40) + ` ${step} of ${total}`)}`);
  console.log('');
}

// ── Parse CLI args ─────────────────────────────────────────────────────────────

let keypairArg = '', addressArg = '';
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--keypair') keypairArg = process.argv[++i] ?? '';
  if (process.argv[i] === '--address') addressArg = process.argv[++i] ?? '';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(`  ${D('·'.repeat(53))}`);
  console.log(`  ${BG(' ██████╗██╗██████╗  ██████╗ ██╗   ██╗██╗████████╗')}`);
  console.log(`  ${BG('██╔════╝██║██╔══██╗██╔════╝ ██║   ██║██║╚══██╔══╝')}`);
  console.log(`  ${BG('██║     ██║██████╔╝██║      ██║   ██║██║   ██║   ')}`);
  console.log(`  ${BG('██║     ██║██╔══██╗██║      ██║   ██║██║   ██║   ')}`);
  console.log(`  ${BG('╚██████╗██║██║  ██║╚██████╔╝╚██████╔╝██║   ██║   ')}`);
  console.log(`  ${BG(' ╚═════╝╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝   ╚═╝  ')}`);
  console.log('');
  console.log(`  ${D('autonomous base chain agent runtime')}  ${G('·')}  ${D('setup wizard')}`);
  console.log(`  ${D('·'.repeat(53))}`);
  console.log('');

  if (addressArg) {
    console.log(`  ${Y('▸  new wallet address (save this!)')}`);
    console.log(`  ${BG(addressArg)}`);
    console.log('');
  }

  const isInteractive = process.stdin.isTTY;
  if (!isInteractive) {
    console.log(`  ${Y('⚠  Non-interactive mode — using defaults for all prompts.')}`);
    console.log(`  ${D('  Re-run: node agent.js setup   to change settings.')}`);
    console.log('');
  }

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: isInteractive,
  });

  // ── Step 1: Base RPC URL ───────────────────────────────────────────────────
  stepHeader(1, 4, 'BASE RPC URL');
  console.log(`  ${D('Used for all Base chain queries: wallet balance, token data, swap execution.')}`);
  console.log(`  ${D('Free options: Alchemy, Infura, QuickNode — or use the public Base endpoint.')}`);
  console.log(`  ${D('Get one (30 seconds):')}  ${Y('https://alchemy.com')}  ${D('→ create app → select Base → copy RPC URL')}`);
  console.log('');

  const existingRpc = envGet('BASE_RPC_URL');
  let heliusRpcUrl;
  if (existingRpc) {
    console.log(`  ${D('current:')}  ${Y(existingRpc.slice(0, 55) + '…')}`);
    const ans = await ask(rl, '  New URL (Enter to keep): ');
    heliusRpcUrl = ans.trim() || existingRpc;
  } else {
    const ans = await ask(rl, '  Base RPC URL (Enter to use public): ');
    heliusRpcUrl = ans.trim();
  }

  if (!heliusRpcUrl) {
    heliusRpcUrl = 'https://mainnet.base.org';
    console.log('');
    console.log(`  ${Y('⚠  Using Base public RPC')}`);
    console.log(`  ${D('  This works but is rate-limited — you may see:')}`);
    console.log(`  ${D('  · Slow balance checks and price lookups')}`);
    console.log(`  ${D('  · Failed swap transactions during high traffic')}`);
    console.log(`  ${D('  · Missed position exits if RPC times out')}`);
    console.log(`  ${D('  Add BASE_RPC_URL to .env later to upgrade.')}`);
  }
  console.log(`  ${G('✓  RPC configured')}`);

  // ── Step 2: LLM provider ──────────────────────────────────────────────────
  stepHeader(2, 4, 'LLM PROVIDER');
  console.log(`  ${D('The AI brain — used for Telegram chat, reflection, and exception handling.')}`);
  console.log('');
  console.log(`  ${G('1')}  ${B('MiniMax')}     ${D('·  cloud, MiniMax-M2.7, API key required')}`);
  console.log(`  ${G('2')}  ${B('Ollama')}      ${D('·  local model, no API cost, GPU recommended')}`);
  console.log('');

  const existingProvider = cfgGet('llm.provider') || 'minimax';
  const provChoice = await ask(rl, `  Choose [1-2]  (Enter = ${existingProvider}): `);
  const llmProvider = provChoice.trim() === '2' ? 'ollama'
    : provChoice.trim() === '1' ? 'minimax'
    : existingProvider;

  let minimaxKey = '';
  let ollamaBaseUrl = '';

  if (llmProvider === 'minimax') {
    console.log('');
    console.log(`  ${D('Get a key at')}  ${Y('https://www.minimax.io/')}`);
    const existingOr = envGet('MINIMAX_API_KEY');
    if (existingOr) {
      console.log(`  ${D('current:')}  ${Y(existingOr.slice(0, 14) + '…')}`);
      const ans = await ask(rl, '  New key (Enter to keep): ');
      minimaxKey = ans.trim() || existingOr;
    } else {
      const ans = await ask(rl, '  MiniMax API key (sk-cp-…): ');
      minimaxKey = ans.trim();
    }
    if (!minimaxKey) {
      console.log(`  ${Y('⚠  No key set — LLM features disabled until added')}`);
    }
  } else {
    console.log('');
    console.log(`  ${D('Install a model first:')}  ollama pull qwen2.5:7b`);
    const existingUrl = cfgGet('llm.baseUrl') || 'http://localhost:11434/v1';
    const ans = await ask(rl, `  Ollama URL (Enter = ${existingUrl}): `);
    ollamaBaseUrl = ans.trim() || existingUrl;
  }
  console.log(`  ${G('✓  Provider:')} ${BG(llmProvider)}`);

  // ── Step 3: AI model ──────────────────────────────────────────────────────
  stepHeader(3, 4, 'AI MODEL');
  let agentModel;

  if (llmProvider === 'ollama') {
    console.log(`  ${D('Model must be pulled first:')}  ollama pull <name>`);
    console.log('');
    console.log(`  ${G('1')}  qwen2.5:7b    ${D('·  best tool use    ·  4.7 GB')}`);
    console.log(`  ${G('2')}  llama3.2:3b   ${D('·  fastest          ·  2 GB')}`);
    console.log(`  ${G('3')}  qwen2.5:14b   ${D('·  best quality     ·  9 GB')}`);
    console.log(`  ${G('4')}  llama3.1:8b   ${D('·  reliable         ·  4.7 GB')}`);
    console.log(`  ${G('5')}  Custom        ${D('·  enter any Ollama model name')}`);
    console.log('');
    const mc = await ask(rl, '  Choose [1-5]  (Enter = 1): ');
    if (mc.trim() === '2') agentModel = 'llama3.2:3b';
    else if (mc.trim() === '3') agentModel = 'qwen2.5:14b';
    else if (mc.trim() === '4') agentModel = 'llama3.1:8b';
    else if (mc.trim() === '5') { const m = await ask(rl, '  Model name: '); agentModel = m.trim(); }
    else agentModel = 'qwen2.5:7b';
  } else {
    console.log(`  ${D('Recommended models:')}`);
    console.log('');
    console.log(`  ${G('1')}  MiniMax-M2.7          ${D('·  best tool use + analysis')}`);
    console.log(`  ${G('2')}  MiniMax-Text-01       ${D('·  fast, cost-efficient')}`);
    console.log(`  ${G('3')}  Custom                ${D('·  enter any MiniMax model ID')}`);
    console.log('');
    const mc = await ask(rl, '  Choose [1-3]  (Enter = 1): ');
    if (mc.trim() === '2') agentModel = 'MiniMax-Text-01';
    else if (mc.trim() === '3') { const m = await ask(rl, '  Model ID: '); agentModel = m.trim(); }
    else agentModel = 'MiniMax-M2.7';
  }
  console.log(`  ${G('✓  Model:')} ${BG(agentModel)}`);

  // ── Step 4: Telegram ──────────────────────────────────────────────────────
  stepHeader(4, 4, 'TELEGRAM  (optional)');
  console.log(`  ${D('Chat interface, trade alerts, and heartbeat messages.')}`);
  console.log(`  ${D('Create a bot:')}  Telegram → ${Y('@BotFather')} → /newbot`);
  console.log('');

  const existingTg = envGet('TELEGRAM_BOT_TOKEN');
  let tgToken = '';
  if (existingTg) {
    console.log(`  ${D('current:')}  ${Y(existingTg.slice(0, 12) + '…')}`);
    const ans = await ask(rl, '  New token (Enter to keep): ');
    tgToken = ans.trim() || existingTg;
  } else {
    const ans = await ask(rl, '  Bot token (Enter to skip): ');
    tgToken = ans.trim();
  }

  let tgChatId = '';
  if (tgToken) {
    console.log('');
    console.log(`  ${D('Your Telegram user ID — used to receive heartbeat messages.')}`);
    console.log(`  ${D('Get it:')}  Telegram → ${Y('@userinfobot')} → /start`);
    const ans = await ask(rl, '  Your Telegram user ID (Enter to skip): ');
    tgChatId = ans.trim();
    console.log(`  ${G('✓  Telegram enabled')}`);
  } else {
    console.log(`  ${D('Skipped — add TELEGRAM_BOT_TOKEN to .env later to enable.')}`);
  }

  // ── (Step 5 removed — no external API required) ──────────────────────────
  // All market data comes from free public sources (DexScreener, GeckoTerminal, GoPlusLabs)

  rl.close();

  // ── Write .env ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(`  ${D('writing .env …')}`);

  const keypair = keypairArg || envGet('PRIVATE_KEY');

  const envContent = [
    `# noelclaw environment — updated ${new Date().toISOString()}`,
    `PRIVATE_KEY=${keypair}`,
    `BASE_RPC_URL=${heliusRpcUrl}`,
    `MINIMAX_API_KEY=${minimaxKey}`,
    `TELEGRAM_BOT_TOKEN=${tgToken}`,
  ].join('\n') + '\n';

  fs.writeFileSync(ENV_FILE, envContent);
  console.log(`  ${G('✓  .env written')}`);

  // ── Write config/agent.local.json ─────────────────────────────────────────
  let local = {};
  try { if (fs.existsSync(CFG_LOCAL)) local = JSON.parse(fs.readFileSync(CFG_LOCAL, 'utf8')); } catch {}

  local.llm           = local.llm ?? {};
  local.llm.model     = agentModel;
  local.llm.provider  = llmProvider;
  if (ollamaBaseUrl)  local.llm.baseUrl = ollamaBaseUrl;

  local.telegram      = local.telegram ?? {};
  if (tgChatId)       local.telegram.heartbeatChatId = tgChatId;

  fs.writeFileSync(CFG_LOCAL, JSON.stringify(local, null, 2) + '\n');
  console.log(`  ${G('✓  config/agent.local.json updated')}`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('');
  console.log('');
  console.log(`  ${D('─'.repeat(49))}`);
  console.log(`  ${BG('✓  AGENT READY')}`);
  console.log(`  ${D('─'.repeat(49))}`);
  console.log('');

  if (addressArg) {
    console.log(`  ${Y('┌─  FUND YOUR AGENT WALLET  ─────────────────────────────────┐')}`);
    console.log(`  ${Y('│')}  ${BG(addressArg)}`);
    console.log(`  ${Y('│')}`);
    console.log(`  ${Y('│')}  Send at least ${B('0.005 ETH')} to this address before starting`);
    console.log(`  ${Y('│')}  (covers gas fees + a few initial trades)`);
    console.log(`  ${Y('└────────────────────────────────────────────────────────────┘')}`);
    console.log('');
    console.log(`  ${D('⚠  Back up your private key:')}  open .env and copy PRIVATE_KEY`);
    console.log('');
  }

  console.log(`  ${D('next steps')}`);
  console.log(`  ${C('  1.')} Fund the wallet above with ETH`);
  console.log(`  ${C('  2.')} ${BG('node agent.js start')}  — launch the agent`);
  console.log(`  ${C('  3.')} ${BG('node agent.js setup')}  — change any settings later`);
  console.log('');
  console.log(`  ${D('optional')}`);
  console.log(`  ${D('  personality')}   cp soul.md soul.local.md`);
  if (process.platform !== 'win32') {
    console.log(`  ${D('  as service')}    systemctl --user enable --now noelclaw`);
  } else {
    console.log(`  ${D('  as service')}    see docs/windows-service.md`);
  }
  console.log('');
}

main().catch(e => { console.error('Wizard error:', e.message); process.exit(1); });
