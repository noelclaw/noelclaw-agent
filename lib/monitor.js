// lib/monitor.js — Autonomous position monitor for noelclaw
// Runs every positionCheckMs (default 10s).
// Checks open positions against stop-loss, take-profit, trailing stop, max hold time.
// Auto-sells when triggered. Prices fetched via DexScreener REST (free, no API cost).
'use strict';

const positions          = require('./positions');
const { reinvestProfit } = require('./circuit-reinvest');
const { loadIdentity }   = require('./profile');

const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [MON] [${level.toUpperCase()}] ${line}\n`);
};

// ── Check one position and exit if rules trigger ──────────────────────────────

async function checkPosition(mint, pos, currentPrice, swap, wallet, cfg, notify, api, forceReason = null) {
  const s = cfg.strategy ?? {};
  const stopLossPct      = s.stopLossPct             ?? -6;
  const takeProfitPct    = s.takeProfitPct            ?? 12;
  const maxHoldMinutes   = s.maxHoldMinutes           ?? 45;
  const trailingActivate = s.trailingStopActivatePct  ?? 4;
  const trailingDistance = s.trailingStopDistancePct  ?? 3;

  if (!currentPrice) {
    log('warn', 'Price unavailable — skipping', { symbol: pos.symbol });
    return;
  }

  // Compute P&L in ETH terms:
  //   priceNative = ETH per 1 UI token (decimal-adjusted)
  //   tokenAmount = raw atomic units → divide by 10^decimals to get UI amount
  const decimals     = pos.tokenDecimals ?? 6;
  const uiAmount     = Number(safeBigInt(pos.tokenAmount)) / Math.pow(10, decimals);
  const currentSolValue = currentPrice * uiAmount;
  const pnlPct  = ((currentSolValue - pos.solSpent) / pos.solSpent) * 100;
  const pnlSol  = currentSolValue - pos.solSpent;
  const holdMin = positions.holdMinutes(pos);

  // Update peak for trailing stop calculation
  if (pnlPct > pos.peakPnlPct) positions.updatePeak(mint, pnlPct);
  const peak = Math.max(pnlPct, pos.peakPnlPct);

  // Trailing stop threshold (only active once peak >= trailingActivate)
  const trailingThreshold = peak >= trailingActivate ? peak - trailingDistance : null;

  log('info', `${pos.symbol} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% | peak ${peak.toFixed(1)}% | ${holdMin.toFixed(0)}min`);

  // Determine exit reason (priority order: stop-loss > take-profit > trailing > max-hold)
  let reason = null;
  if (pnlPct <= stopLossPct) {
    reason = 'stop-loss';
  } else if (pnlPct >= takeProfitPct) {
    reason = 'take-profit';
  } else if (trailingThreshold !== null && pnlPct <= trailingThreshold) {
    reason = 'trailing-stop';
  } else if (holdMin >= maxHoldMinutes) {
    reason = 'max-hold';
  }

  if (forceReason) reason = forceReason;
  if (!reason) return;

  log('info', `Exiting ${pos.symbol} — ${reason}`, { pnl: pnlPct.toFixed(1) + '%' });

  try {
    const rawAmount = Number(safeBigInt(pos.tokenAmount));
    const result    = await swap.sell(mint, rawAmount);

    const exitData = {
      exitPrice:   currentPrice,
      exitTime:    new Date().toISOString(),
      solReceived: result.solReceived,
      pnlSol:      result.solReceived - pos.solSpent,
      pnlPct,
      reason,
      txSig:       result.txSig,
    };
    // closePosition handles trade logging internally — do not call logClosedTrade separately
    positions.closePosition(mint, exitData);

    const sign = pnlPct >= 0 ? '+' : '';
    const icon = pnlPct >= 0 ? '🟢' : '🔴';
    notify(
      `${icon} *${pos.symbol}* exited (${reason})\n` +
      `P&L: ${sign}${pnlPct.toFixed(1)}% / ${sign}${pnlSol.toFixed(6)} ETH\n` +
      `Held: ${holdMin.toFixed(0)}min | Peak: +${peak.toFixed(1)}%`
    );
    log('info', 'Position closed', { symbol: pos.symbol, reason, pnl: pnlPct.toFixed(1) + '%', sol: result.solReceived.toFixed(4) });

    // Report outcome to swarm — makes reputation real and consensus trustworthy
    _reportSwarmOutcome(api, mint, pos.symbol, pnlPct, result.solReceived - pos.solSpent, holdMin, cfg)
      .catch(e => log('warn', 'Swarm outcome report failed', { error: e.message }));

    // Broadcast sell signal — other agents holding this mint can react
    _broadcastSellSignal(api, mint, pos.symbol, pnlPct, reason, cfg)
      .catch(() => {});

    // Reinvest a slice of profit into NOELCLAW — the agent grows by being profitable
    const actualPnlSol = result.solReceived - pos.solSpent;
    if (actualPnlSol > 0) {
      reinvestProfit({ pnlSol: actualPnlSol, symbol: pos.symbol, swap, wallet, cfg, notify })
        .catch(e => log('warn', 'Reinvest error', { error: e.message }));
    }
  } catch (err) {
    log('error', 'Sell failed', { symbol: pos.symbol, error: err.message.slice(0, 120) });
    notify(`⚠️ *${pos.symbol}* sell failed (${reason}):\n${err.message.slice(0, 200)}`);
    throw err; // re-throw so the tick can count retries and write off after MAX_SELL_RETRIES
  }
}

// ── Swarm sell signal detection ───────────────────────────────────────────────
// Returns Set of mints where peer agents have recently published sell signals.
// Returns graceful empty set if swarm API unavailable.

async function _getSwarmSellSignals(mints, cfg, api) {
  if (!mints.length || !cfg.swarm?.enabled) return new Set();
  try {
    const headers = api?.internalKey ? { 'X-Internal-Key': api.internalKey } : {};
    const resp = await api._fetch('/api/swarm/feed?type=sell_signal&limit=50', headers);
    if (!resp.ok) return new Set();
    const { signals = [] } = await resp.json();
    // Only signals from the last 10 minutes matter for coordinated exit
    const cutoff = Date.now() - 10 * 60_000;
    return new Set(
      signals
        .filter(s => s.mint && mints.includes(s.mint) && new Date(s.publishedAt).getTime() > cutoff)
        .map(s => s.mint)
    );
  } catch { return new Set(); }
}

// ── Swarm outcome reporting ───────────────────────────────────────────────────

async function _reportSwarmOutcome(api, mint, symbol, pnlPct, pnlSol, holdMinutes, cfg) {
  const identity = loadIdentity();
  if (!identity.agentId && !identity.address) return;

  await api.swarmOutcome({
    agentId:  identity.agentId,
    address:  identity.address,
    mint, symbol, pnlPct, pnlSol, holdMinutes,
    verdict:  pnlPct > 0 ? 'win' : 'loss',
  });
  log('info', `Swarm outcome reported: ${symbol} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
}

// ── Broadcast sell signal for coordinated exit ────────────────────────────────

async function _broadcastSellSignal(api, mint, symbol, pnlPct, reason, cfg) {
  if (!cfg.swarm?.autoPublish) return;
  const identity = loadIdentity();
  if (!identity.agentId && !identity.address) return;

  await api.swarmPublish({
    agentId:    identity.agentId,
    address:    identity.address,
    type:       'sell_signal',
    mint, symbol,
    confidence: pnlPct > 0 ? 0.9 : 0.7,
    data:       { pnlPct: +pnlPct.toFixed(2), reason },
  });
}

// ── Safe BigInt — handles scientific notation strings from old positions ─────────
// Number("8.549e+22") works; BigInt("8.549e+22") throws. Round-trip via Number.
function safeBigInt(val) {
  const s = String(val ?? 0);
  if (s.includes('e') || s.includes('E') || s.includes('.')) {
    return BigInt(Math.round(Number(s)));
  }
  return BigInt(s);
}

// ── DexScreener price fetch (free, no API cost) ──────────────────────────────────
// Fetches priceNative (ETH per token) for a batch of mints.
// Falls back to GeckoTerminal per-token endpoint on missing prices.

const DEXSCREENER_BASE  = 'https://api.dexscreener.com/tokens/v1/base';
const GECKOTERMINAL_BASE = 'https://api.geckoterminal.com/api/v2/networks/base/tokens';

async function _fetchDexscreenerPrices(mints) {
  if (!mints.length) return {};
  const url  = `${DEXSCREENER_BASE}/${mints.join(',')}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!resp.ok) throw new Error(`DexScreener ${resp.status}`);
  const pairs = await resp.json();
  if (!Array.isArray(pairs)) throw new Error('Unexpected DexScreener response shape');

  const priceMap = {};
  for (const mint of mints) {
    // Case-insensitive match — DexScreener returns checksummed addresses
    const tokenPairs = pairs.filter(p => p.baseToken?.address?.toLowerCase() === mint.toLowerCase());
    if (!tokenPairs.length) continue;
    const best = tokenPairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    priceMap[mint] = {
      priceNative: parseFloat(best.priceNative) || null,
      usdPrice:    parseFloat(best.priceUsd)    || null,
    };
  }
  return priceMap;
}

// ── GeckoTerminal price fallback for a single mint ────────────────────────────
// Used when DexScreener has no pairs for a token (new/low-liquidity tokens).

async function _fetchGeckoTerminalPrice(mint) {
  try {
    const url  = `${GECKOTERMINAL_BASE}/${mint}/pools?page=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    const pools = json?.data ?? [];
    if (!pools.length) return null;
    // Use highest-liquidity pool
    const best = pools
      .map(p => ({ ...p.attributes }))
      .filter(a => a.base_token_price_native_currency)
      .sort((a, b) => (parseFloat(b.reserve_in_usd) || 0) - (parseFloat(a.reserve_in_usd) || 0))[0];
    if (!best) return null;
    return {
      priceNative: parseFloat(best.base_token_price_native_currency) || null,
      usdPrice:    parseFloat(best.base_token_price_usd)             || null,
    };
  } catch { return null; }
}

// ── Start monitor loop ────────────────────────────────────────────────────────

function start(cfg, agentCtx, telegramBot = null) {
  const { api, swap, wallet } = agentCtx;
  const intervalMs = cfg.strategy?.positionCheckMs ?? 10_000; // default 10s (was 30s)
  const chatId = cfg.telegram?.heartbeatChatId ?? null;

  // Track consecutive price-unavailable failures per mint
  const _priceFailCount = {};
  // Track consecutive sell failures per mint — after MAX_SELL_RETRIES, write off the position
  const _sellFailCount  = {};
  const MAX_SELL_RETRIES = 4;
  // Guard against concurrent ticks (10s interval can overlap on slow networks)
  let _tickRunning = false;

  const notify = (msg) => {
    log('info', `[notify] ${msg.replace(/\*/g, '').replace(/\n/g, ' | ').slice(0, 120)}`);
    if (telegramBot && chatId) {
      telegramBot.api?.sendMessage(chatId, msg, { parse_mode: 'Markdown' })
        .catch(() => telegramBot.api?.sendMessage(chatId, msg).catch(() => {}));
    }
  };

  log('info', `Position monitor started — checking every ${intervalMs / 1000}s (prices via DexScreener/GeckoTerminal)`);

  const tick = async () => {
    if (_tickRunning) return; // prevent concurrent ticks
    _tickRunning = true;
    try { await _tick(); } finally { _tickRunning = false; }
  };

  const _tick = async () => {
    const held  = positions.getAll();
    const mints = Object.keys(held);
    if (!mints.length) return;

    // Fetch prices via DexScreener first
    let priceMap = {};
    try {
      priceMap = await _fetchDexscreenerPrices(mints);
      log('info', `Prices fetched (DexScreener) for ${mints.length} position(s)`);
    } catch (dexErr) {
      log('warn', 'DexScreener batch failed', { error: dexErr.message });
    }

    // For any mint still missing a price, try GeckoTerminal individually
    for (const mint of mints) {
      if (priceMap[mint]?.priceNative || priceMap[mint]?.usdPrice) continue;
      const gp = await _fetchGeckoTerminalPrice(mint);
      if (gp) {
        priceMap[mint] = gp;
        log('info', `Price from GeckoTerminal for ${held[mint]?.symbol ?? mint.slice(0, 8)}`);
      }
    }

    // Coordinated exit: check swarm for sell signals on our held mints
    // If a peer agent exited a token we hold, treat it as an early warning
    const swarmSellMints = await _getSwarmSellSignals(mints, cfg, api);

    for (const mint of mints) {
      const pos = positions.get(mint);
      if (!pos) continue;

      const priceData    = priceMap[mint];
      const currentPrice = priceData?.priceNative ?? priceData?.usdPrice ?? null;

      // Track consecutive price failures — force-close after maxHoldMinutes worth of failures
      if (!currentPrice) {
        _priceFailCount[mint] = (_priceFailCount[mint] ?? 0) + 1;
        const maxHoldMs    = (cfg.strategy?.maxHoldMinutes ?? 45) * 60_000;
        const failThreshold = Math.ceil(maxHoldMs / intervalMs); // e.g. 45min / 10s = 270 failures
        const holdMin       = positions.holdMinutes(pos);
        if (_priceFailCount[mint] >= failThreshold || holdMin >= (cfg.strategy?.maxHoldMinutes ?? 45)) {
          log('warn', `${pos.symbol} — price unavailable for ${holdMin.toFixed(0)}min — force-closing`, { failCount: _priceFailCount[mint] });
          notify(`⚠️ *${pos.symbol}* held ${holdMin.toFixed(0)}min with no price feed — force-closing to protect capital`);
          try {
            const rawAmount = Number(safeBigInt(pos.tokenAmount));
            const result    = await swap.sell(mint, rawAmount);
            positions.closePosition(mint, {
              exitPrice:   0,
              exitTime:    new Date().toISOString(),
              solReceived: result.solReceived ?? 0,
              pnlSol:      (result.solReceived ?? 0) - pos.solSpent,
              pnlPct:      pos.solSpent ? (((result.solReceived ?? 0) - pos.solSpent) / pos.solSpent) * 100 : 0,
              reason:      'no-price-feed',
              txSig:       result.txSig,
            });
            delete _priceFailCount[mint];
          } catch (err) {
            log('error', `Force-close sell failed for ${pos.symbol} — writing off`, { error: err.message.slice(0, 80) });
            // Sell itself failed (STF/honeypot) — write off the position
            notify(`☠️ *${pos.symbol}* force-close failed — writing off as honeypot/unsellable`);
            positions.closePosition(mint, {
              exitPrice: 0, exitTime: new Date().toISOString(),
              solReceived: 0, pnlSol: -pos.solSpent, pnlPct: -100,
              reason: 'write-off-unsellable', txSig: null,
            });
          }
          delete _priceFailCount[mint];
          continue;
        }
        log('warn', `Price unavailable for ${pos.symbol} (${_priceFailCount[mint]}/${failThreshold})`);
        continue;
      }
      _priceFailCount[mint] = 0; // reset on successful price fetch

      // If peer agents are selling this mint and we're in the red, exit early
      if (swarmSellMints.has(mint)) {
        const decimals        = pos.tokenDecimals ?? 6;
        const uiAmt           = Number(safeBigInt(pos.tokenAmount)) / Math.pow(10, decimals);
        const currentSolValue = (currentPrice ?? 0) * uiAmt;
        const pnlPct          = pos.solSpent ? ((currentSolValue - pos.solSpent) / pos.solSpent) * 100 : 0;
        if (pnlPct < 0) {
          log('info', `Swarm sell signal detected for ${pos.symbol} — exiting early`, { pnlPct: pnlPct.toFixed(1) });
          // Inject a reason that will trigger exit in checkPosition
          try {
            await checkPosition(mint, pos, currentPrice, swap, wallet, cfg, notify, api, 'swarm-exit');
          } catch (err) {
            log('error', 'Swarm-exit error', { mint: mint.slice(0, 8), error: err.message });
          }
          continue;
        }
      }

      try {
        await checkPosition(mint, pos, currentPrice, swap, wallet, cfg, notify, api);
        _sellFailCount[mint] = 0; // reset on success
      } catch (err) {
        _sellFailCount[mint] = (_sellFailCount[mint] ?? 0) + 1;
        log('error', `Sell error (${_sellFailCount[mint]}/${MAX_SELL_RETRIES})`, { symbol: pos.symbol, error: err.message.slice(0, 80) });
        if (_sellFailCount[mint] >= MAX_SELL_RETRIES) {
          // Token is likely a honeypot or transfer-restricted — write off and stop retrying
          log('warn', `${pos.symbol} — ${MAX_SELL_RETRIES} sell failures — writing off position (likely honeypot/no-pool)`);
          notify(`☠️ *${pos.symbol}* — sell failed ${MAX_SELL_RETRIES}× (STF/no-pool) — writing off 0.0005 ETH and removing from books`);
          positions.closePosition(mint, {
            exitPrice:   0,
            exitTime:    new Date().toISOString(),
            solReceived: 0,
            pnlSol:      -pos.solSpent,
            pnlPct:      -100,
            reason:      'write-off-unsellable',
            txSig:       null,
          });
          delete _sellFailCount[mint];
        }
      }
    }
  };

  // First check after 15s, then on interval
  setTimeout(tick, 15_000);
  setInterval(tick, intervalMs);
}

module.exports = { start };
