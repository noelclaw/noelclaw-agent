// lib/circuit.js — Noelclaw Data client (free public APIs, no x402 payment)
// Replaces circuit.js paid API with direct calls to:
//   DexScreener · GeckoTerminal · GoPlusLabs · CoinGecko · DeFiLlama · Alternative.me
'use strict';

process.stdout.on('error', e => { if (e.code !== 'EPIPE') throw e; });

const { ethers } = require('ethers');

// NOELCLAW ERC-20 token address on Base
const CIRCUIT_MINT     = '0x4B524015D54a27d4472F5c59c570730D69499Ba3';
const CIRCUIT_DECIMALS = 18;

const ERC20_ABI = [
  'function transfer(address to,uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [NOELCLAW] [${level.toUpperCase()}] ${line}\n`);
};

const fetchJson = async (url, opts = {}) => {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15_000), ...opts });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);
  return resp.json();
};

class CircuitClient {
  constructor(opts = {}) {
    this.wallet = opts.wallet ?? null;
    // kept for compat — not used for payment
    this.baseUrl = 'https://api.noelclaw.com';
  }

  // ── scan — GeckoTerminal trending + new pools on Base ───────────────────────

  async scan(opts = {}) {
    const { limit = 40, minLiquidity = 10000 } = opts;
    try {
      // Pull trending + new pools on Base in parallel
      const [trending, newPools] = await Promise.allSettled([
        fetchJson('https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1'),
        fetchJson('https://api.geckoterminal.com/api/v2/networks/base/new_pools?page=1'),
      ]);

      const raw = [
        ...(trending.status === 'fulfilled' ? trending.value.data ?? [] : []),
        ...(newPools.status  === 'fulfilled' ? newPools.value.data  ?? [] : []),
      ];

      // Deduplicate by pool address
      const seen = new Set();
      const pools = raw.filter(p => {
        if (!p?.attributes) return false;
        const id = p.id;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      const candidates = pools
        .map(p => {
          const a     = p.attributes ?? {};
          const txns  = a.transactions ?? {};
          const pc    = a.price_change_percentage ?? {};
          const vol   = a.volume_usd ?? {};
          const liq   = parseFloat(a.reserve_in_usd ?? 0);

          // Extract base token address from relationship
          const tokenRel = p.relationships?.base_token?.data?.id ?? '';
          const mint     = tokenRel.includes('_') ? tokenRel.split('_')[1] : tokenRel;
          if (!mint || !mint.startsWith('0x')) return null;

          return {
            mint,
            symbol:         a.name?.split(' / ')[0] ?? mint.slice(0, 8),
            name:           a.name ?? '',
            priceUsd:       parseFloat(a.base_token_price_usd ?? 0),
            priceChange5m:  parseFloat(pc.m5  ?? 0),
            priceChange1h:  parseFloat(pc.h1  ?? 0),
            priceChange6h:  parseFloat(pc.h6  ?? 0),
            priceChange24h: parseFloat(pc.h24 ?? 0),
            volume1h:       parseFloat(vol.h1  ?? 0),
            volume24h:      parseFloat(vol.h24 ?? 0),
            liquidity:      liq,
            buys5m:         txns.m5?.buys  ?? 0,
            sells5m:        txns.m5?.sells ?? 0,
            buys1h:         txns.h1?.buys  ?? 0,
            sells1h:        txns.h1?.sells ?? 0,
            pairAddress:    a.address,
            dexId:          p.relationships?.dex?.data?.id ?? 'unknown',
          };
        })
        .filter(c => c && c.liquidity >= minLiquidity)
        .slice(0, limit);

      log('info', `scan: ${candidates.length} Base pools from GeckoTerminal`, { trending: trending.status === 'fulfilled' ? trending.value.data?.length : 0 });
      return { candidates, count: candidates.length };
    } catch (err) {
      log('warn', 'scan failed', { error: err.message });
      return { candidates: [], count: 0 };
    }
  }

  // ── token-price — DexScreener ────────────────────────────────────────────────

  async tokenPrice(mint) {
    try {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`
      );
      const p = (data.pairs ?? []).filter(x => x.chainId === 'base')[0];
      if (!p) return null;
      return {
        mint,
        symbol:         p.baseToken?.symbol,
        priceUsd:       parseFloat(p.priceUsd ?? 0),
        priceChange1h:  p.priceChange?.h1  ?? 0,
        priceChange24h: p.priceChange?.h24 ?? 0,
        volume24h:      p.volume?.h24 ?? 0,
        liquidity:      p.liquidity?.usd ?? 0,
      };
    } catch (err) {
      log('warn', 'tokenPrice failed', { mint, error: err.message });
      return null;
    }
  }

  async tokenPrices(mints) {
    const results = await Promise.allSettled(mints.map(m => this.tokenPrice(m)));
    return results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
  }

  // ── token-info — GoPlusLabs rug analysis ────────────────────────────────────

  async tokenInfo(mint) {
    try {
      const data = await fetchJson(
        `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${mint}`
      );
      const info = data.result?.[mint.toLowerCase()] ?? data.result?.[mint] ?? {};

      const isMintable  = info.is_mintable === '1';
      const isFreezeAuth = info.transfer_pausable === '1';
      const lpLocked    = parseFloat(info.lp_holders?.find(h => h.is_locked)?.percent ?? 0) * 100;
      const rugScore    = (isMintable ? 30 : 0) + (isFreezeAuth ? 30 : 0) + (lpLocked < 50 ? 20 : 0);

      return {
        mint,
        rugScore,
        verdict:      rugScore >= 60 ? 'danger' : rugScore >= 30 ? 'caution' : 'safe',
        isMintable,
        isFreezeAuth,
        lpLocked:     lpLocked.toFixed(1) + '%',
        holderCount:  info.holder_count ?? null,
        isOpenSource: info.is_open_source === '1',
        isProxy:      info.is_proxy === '1',
        buyTax:       info.buy_tax ?? '0',
        sellTax:      info.sell_tax ?? '0',
        raw:          info,
      };
    } catch (err) {
      log('warn', 'tokenInfo failed', { mint, error: err.message });
      return { mint, verdict: 'unknown', rugScore: 0 };
    }
  }

  // ── token-holders — GoPlusLabs ───────────────────────────────────────────────

  async tokenHolders(mint) {
    try {
      const data = await fetchJson(
        `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${mint}`
      );
      const info    = data.result?.[mint.toLowerCase()] ?? data.result?.[mint] ?? {};
      const holders = info.holders ?? [];
      const top5Pct = holders.slice(0, 5).reduce((s, h) => s + parseFloat(h.percent ?? 0), 0) * 100;
      return {
        mint,
        holderCount: info.holder_count ?? null,
        top5Pct:     top5Pct.toFixed(1),
        holders:     holders.slice(0, 10),
      };
    } catch (err) {
      log('warn', 'tokenHolders failed', { mint, error: err.message });
      return { mint, holderCount: null, top5Pct: '0', holders: [] };
    }
  }

  // ── market-overview — GeckoTerminal trending Base pools ─────────────────────

  async marketOverview() {
    try {
      const [trending, top] = await Promise.allSettled([
        fetchJson('https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1'),
        fetchJson('https://api.geckoterminal.com/api/v2/networks/base/pools?sort=h24_volume_usd_liquidity_desc&page=1'),
      ]);
      const trendingPools = trending.status === 'fulfilled'
        ? (trending.value.data ?? []).slice(0, 10).map(p => ({
            address:       p.relationships?.base_token?.data?.id?.split('_')[1],
            name:          p.attributes?.name,
            priceChange1h: parseFloat(p.attributes?.price_change_percentage?.h1 ?? 0),
            volume24h:     parseFloat(p.attributes?.volume_usd?.h24 ?? 0),
            liquidity:     parseFloat(p.attributes?.reserve_in_usd ?? 0),
          }))
        : [];
      return { trending: trendingPools, source: 'geckoterminal' };
    } catch (err) {
      log('warn', 'marketOverview failed', { error: err.message });
      return { trending: [], source: 'geckoterminal' };
    }
  }

  // ── market-sentiment — Alternative.me Fear & Greed ──────────────────────────

  async marketSentiment() {
    try {
      const data = await fetchJson('https://api.alternative.me/fng/?limit=1');
      const d    = data.data?.[0] ?? {};
      return {
        fearGreed: {
          value:          parseInt(d.value ?? 50),
          classification: d.value_classification ?? 'Neutral',
          timestamp:      d.timestamp,
        },
      };
    } catch (err) {
      log('warn', 'marketSentiment failed', { error: err.message });
      return { fearGreed: { value: 50, classification: 'Neutral' } };
    }
  }

  // ── oracle-prices — CoinGecko free ──────────────────────────────────────────

  async oraclePrices() {
    try {
      const data = await fetchJson(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,usd-coin,wrapped-bitcoin&vs_currencies=usd&include_24hr_change=true'
      );
      return {
        ETH:  { usd: data.ethereum?.usd,         change24h: data.ethereum?.usd_24h_change },
        BTC:  { usd: data.bitcoin?.usd,           change24h: data.bitcoin?.usd_24h_change },
        USDC: { usd: data['usd-coin']?.usd,       change24h: 0 },
        WBTC: { usd: data['wrapped-bitcoin']?.usd, change24h: data['wrapped-bitcoin']?.usd_24h_change },
      };
    } catch (err) {
      log('warn', 'oraclePrices failed', { error: err.message });
      return {};
    }
  }

  // ── defi-overview — DeFiLlama Base protocols ────────────────────────────────

  async defiOverview() {
    try {
      const data = await fetchJson('https://api.llama.fi/v2/chains');
      const base = (data ?? []).find(c => c.name?.toLowerCase() === 'base');
      return {
        chain:  'base',
        tvl:    base?.tvl ?? null,
        source: 'defillama',
      };
    } catch (err) {
      log('warn', 'defiOverview failed', { error: err.message });
      return { chain: 'base', tvl: null };
    }
  }

  // ── top-pools — DexScreener ──────────────────────────────────────────────────

  async topPools(limit = 20) {
    try {
      const data = await fetchJson(
        'https://api.dexscreener.com/latest/dex/search?q=base'
      );
      const pools = (data.pairs ?? [])
        .filter(p => p.chainId === 'base')
        .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))
        .slice(0, limit)
        .map(p => ({
          pairAddress: p.pairAddress,
          baseToken:   p.baseToken?.symbol,
          quoteToken:  p.quoteToken?.symbol,
          volume24h:   p.volume?.h24 ?? 0,
          liquidity:   p.liquidity?.usd ?? 0,
          dexId:       p.dexId,
        }));
      return { pools, count: pools.length };
    } catch (err) {
      log('warn', 'topPools failed', { error: err.message });
      return { pools: [], count: 0 };
    }
  }

  // ── token-ohlcv — DexScreener candles ───────────────────────────────────────

  async tokenOhlcv(mint, timeframe = '1H', limit = 24) {
    try {
      const data = await fetchJson(
        `https://api.dexscreener.com/latest/dex/tokens/${mint}`
      );
      const pair = (data.pairs ?? []).filter(p => p.chainId === 'base')[0];
      if (!pair) return { candles: [] };
      return {
        mint,
        symbol:  pair.baseToken?.symbol,
        current: parseFloat(pair.priceUsd ?? 0),
        candles: [],
        note:    'Use DexScreener chart for full OHLCV',
      };
    } catch (err) {
      log('warn', 'tokenOhlcv failed', { mint, error: err.message });
      return { candles: [] };
    }
  }

  // ── news — stub (no free crypto news API without key) ───────────────────────

  async news(opts = {}) {
    return { articles: [], note: 'Use web_search tool for live crypto news' };
  }

  async networkStats() {
    return { chain: 'base', note: 'Use oracle-prices and defi-overview for stats' };
  }

  async stakingYields() {
    try {
      const data = await fetchJson('https://yields.llama.fi/pools');
      const base = (data.data ?? [])
        .filter(p => p.chain === 'Base')
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 10);
      return { yields: base, source: 'defillama' };
    } catch (err) {
      return { yields: [] };
    }
  }

  async status() {
    return { status: 'ok', source: 'noelclaw-free-api' };
  }

  // ── Swarm — graceful no-ops (circuit-specific infra) ────────────────────────
  // These return safe empty responses so agent logic doesn't crash.

  async swarmPublish(opts = {}) {
    log('info', 'swarm publish skipped (self-hosted infra not connected)');
    return { ok: true, skipped: true };
  }

  async swarmOutcome(opts = {}) {
    return { ok: true, skipped: true };
  }

  async swarmFeed(opts = {}) {
    return { signals: [], total: 0 };
  }

  async swarmConsensus(mint) {
    return { consensus: 'neutral', agents: 0, skipped: true };
  }

  async swarmStats() {
    return { agents: 0, signals: 0 };
  }

  async swarmLeaderboard(limit = 20) {
    return { agents: [] };
  }

  async swarmInsights(limit = 20) {
    return { insights: [] };
  }

  async taskList(opts = {})   { return { tasks: [] }; }
  async taskClaim(taskId)     { return { ok: false, skipped: true }; }
  async taskSubmit(opts = {}) { return { ok: false, skipped: true }; }

  // ── NOELCLAW token balance ───────────────────────────────────────────────────

  async _getCircuitBalance() {
    if (!this.wallet) return 0;
    const { signer } = this.wallet;
    if (!CIRCUIT_MINT) return 0;
    try {
      const contract = new ethers.Contract(CIRCUIT_MINT, ERC20_ABI, signer.provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(signer.address),
        contract.decimals(),
      ]);
      return parseFloat(ethers.formatUnits(balance, decimals));
    } catch {
      return 0;
    }
  }
}

module.exports = { CircuitClient, CIRCUIT_MINT };
