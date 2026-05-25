// lib/circuit-reinvest.js — Buy CIRCUIT with a slice of each profitable trade exit.
// The agent lives on CIRCUIT. Profit feeds survival.
// Called by monitor.js after every winning close.
'use strict';

const fs   = require('fs');
const path = require('path');

const { CIRCUIT_MINT } = require('./circuit');

const STATS_FILE    = path.join(__dirname, '../data/reinvest_stats.json');
const MIN_ETH_BUY   = 0.0001; // minimum ETH to bother reinvesting (~$0.35)

const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [REINVEST] [${level.toUpperCase()}] ${line}\n`);
};

// ── Load / save stats ─────────────────────────────────────────────────────────

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch { /* ignore */ }
  return { totalCircuitBought: 0, totalEthReinvested: 0, reinvestCount: 0, history: [] };
}

function saveStats(stats) {
  fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
  const tmp = STATS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(stats, null, 2));
  fs.renameSync(tmp, STATS_FILE);
}

// ── Buy CIRCUIT from a profitable close ──────────────────────────────────────

/**
 * Reinvest a portion of trade profit into CIRCUIT.
 * @param {object} opts
 *   pnlSol    {number}   — profit in ETH from the closed trade (named pnlSol for compat)
 *   symbol    {string}   — token that was sold (for logging)
 *   swap      {object}   — SwapExecutor instance
 *   wallet    {object}   — WalletManager (for balance check)
 *   cfg       {object}   — agent config
 *   notify    {function} — Telegram notify callback
 */
async function reinvestProfit({ pnlSol, symbol, swap, wallet, cfg, notify }) {
  const reinvestPct = cfg.survival?.circuitReinvestPct ?? 0.25;
  const minEthPause = cfg.survival?.minEthPause ?? cfg.survival?.minSolPause ?? 0.001;

  if (pnlSol <= 0) return; // only on profit
  const ethToBuy = pnlSol * reinvestPct;
  if (ethToBuy < MIN_ETH_BUY) {
    log('info', `Profit too small to reinvest (${ethToBuy.toFixed(6)} ETH < ${MIN_ETH_BUY})`);
    return;
  }

  // Safety: check we won't drain below survival floor
  let ethBalance = 0;
  try { ethBalance = (await wallet.getBalances()).eth ?? 0; } catch { return; }
  if (ethBalance - ethToBuy < minEthPause) {
    log('warn', 'Skipping CIRCUIT reinvest — would breach minEthPause', { balance: ethBalance, ethToBuy });
    return;
  }

  if (!CIRCUIT_MINT || CIRCUIT_MINT.startsWith('CIRC_')) {
    log('warn', 'CIRCUIT token address not yet configured — skipping reinvest');
    return;
  }

  log('info', `Reinvesting ${(reinvestPct * 100).toFixed(0)}% of profit into CIRCUIT`, {
    pnlEth: pnlSol.toFixed(6), ethToBuy: ethToBuy.toFixed(6),
  });

  try {
    const result = await swap.buy(CIRCUIT_MINT, ethToBuy);
    const circuitReceived = Number(result.outAmount);

    const stats = loadStats();
    stats.totalEthReinvested += ethToBuy;
    stats.totalCircuitBought += circuitReceived;
    stats.reinvestCount      += 1;
    stats.history.push({
      at:             new Date().toISOString(),
      fromTrade:      symbol,
      pnlEth:         +pnlSol.toFixed(6),
      ethReinvested:  +ethToBuy.toFixed(6),
      circuitReceived,
      txSig:          result.txSig,
    });
    if (stats.history.length > 100) stats.history = stats.history.slice(-100);
    saveStats(stats);

    const circuit = (circuitReceived / 1_000_000).toFixed(0);
    log('info', 'CIRCUIT reinvest complete', { circuit, txHash: result.txSig?.slice(0, 18) });
    notify(
      `CIRCUIT +${circuit}k — reinvested ${(reinvestPct * 100).toFixed(0)}% of ${symbol} profit ` +
      `(${pnlSol.toFixed(6)} ETH → ${ethToBuy.toFixed(6)} ETH → CIRCUIT)`
    );
  } catch (err) {
    log('error', 'CIRCUIT reinvest failed', { error: err.message });
  }
}

// ── Read stats for reflect prompt ─────────────────────────────────────────────

function getStats() {
  return loadStats();
}

module.exports = { reinvestProfit, getStats, CIRCUIT_MINT };
