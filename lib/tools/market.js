// lib/tools/market.js — market data + research tool definitions and handlers
'use strict';

const DEFINITIONS = [
  // ── Base chain data tools ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'scan_tokens',
      description: 'Scan for trending Base chain tokens with dip-reversal signals. Returns candidates sorted by score with price changes, liquidity, volume, and GoPlus safety ratings. Use this to find trading opportunities.',
      parameters: {
        type: 'object',
        properties: {
          limit:        { type: 'number',  description: 'Max results (default 20, max 50)' },
          minLiquidity: { type: 'number',  description: 'Min liquidity in USD (default 10000)' },
          safeOnly:     { type: 'boolean', description: 'Only include RugCheck-safe tokens (default false)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'token_price',
      description: 'Get current price and 24h stats for a specific Base chain token by contract address. Returns USD price from DexScreener and CoinGecko.',
      parameters: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'The Base chain token contract address (0x...)' },
        },
        required: ['mint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'market_overview',
      description: 'Get a broad Base chain market overview: trending tokens on DexScreener and GeckoTerminal. Good for understanding what is hot right now.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'network_stats',
      description: 'Get live Base network statistics: block height, TPS, gas price (gwei), and network health.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'staking_yields',
      description: 'Get current staking APYs for ETH LSTs on Base (cbETH, wstETH, rETH) and ETH staking yields. Useful for yield comparisons.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'defi_overview',
      description: 'Get Base DeFi overview: top protocols by TVL (Uniswap, Aerodrome, Aave, Compound, Curve, etc.) and overall ecosystem stats.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'market_sentiment',
      description: 'Get crypto market sentiment: Fear & Greed index, LunarCrush social scores, and sentiment signals.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'oracle_prices',
      description: 'Get real-time oracle prices for ETH, BTC, WBTC and other majors on Base. Reliable on-chain price source.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // ── Research tools ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'token_info',
      description: 'Get detailed metadata for a Base chain token: name, symbol, deployer, GoPlus security score, supply, and holder count.',
      parameters: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token mint address' },
        },
        required: ['mint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'token_holders',
      description: 'Get top holder distribution for a token. Useful for spotting whale concentration or team supply risk.',
      parameters: {
        type: 'object',
        properties: {
          mint:  { type: 'string', description: 'Token mint address' },
          limit: { type: 'number', description: 'Top N holders to return (default 20)' },
        },
        required: ['mint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'token_chart',
      description: 'Get OHLCV candlestick data for a token. Use to read price trajectory before entering.',
      parameters: {
        type: 'object',
        properties: {
          mint:      { type: 'string', description: 'Token mint address' },
          timeframe: { type: 'string', description: 'Candle size: 1m, 5m, 15m, 1H, 4H, 1D (default 1H)' },
          limit:     { type: 'number', description: 'Number of candles (default 24)' },
        },
        required: ['mint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Get recent crypto news headlines. Use to check for macro events affecting the market.',
      parameters: {
        type: 'object',
        properties: {
          limit:  { type: 'number', description: 'Headlines to return (default 10)' },
          filter: { type: 'string', description: 'rising, hot, bullish, bearish, important, saved (default rising)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'top_pools',
      description: 'Get top liquidity pools on Base by volume or TVL (Uniswap v3, Aerodrome). Useful for spotting where liquidity is concentrated.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of pools to return (default 20)' },
        },
        required: [],
      },
    },
  },
];

const HANDLERS = {
  async scan_tokens(args, ctx, _log) {
    const { api } = ctx;
    const result = await api.scan({
      limit:        args.limit       ?? 20,
      minLiquidity: args.minLiquidity ?? 10000,
      safeOnly:     args.safeOnly    ?? false,
    });
    const top = (result.candidates ?? []).slice(0, 10).map(c => ({
      symbol:    c.symbol,
      mint:      c.mint,
      price:     c.price,
      change1h:  c.priceChange1h,
      change24h: c.priceChange24h,
      liquidity: c.liquidity,
      volume24h: c.volume24h,
      buys1h:    c.txns1h?.buys,
      sells1h:   c.txns1h?.sells,
      rugRisk:   c.rugRisk,
      verdict:   c.verdict,
    }));
    return JSON.stringify({ candidates: top, total: result.candidates?.length ?? 0 });
  },

  async token_price(args, ctx, _log) {
    const data = await ctx.api.tokenPrice(args.mint);
    return JSON.stringify(data ?? { error: 'Price unavailable' });
  },

  async market_overview(args, ctx, _log) {
    const data = await ctx.api.marketOverview();
    return JSON.stringify(data ?? { error: 'Market data unavailable' });
  },

  async network_stats(args, ctx, _log) {
    const data = await ctx.api.networkStats();
    return JSON.stringify(data ?? { error: 'Network stats unavailable' });
  },

  async staking_yields(args, ctx, _log) {
    const data = await ctx.api.stakingYields();
    return JSON.stringify(data ?? { error: 'Staking data unavailable' });
  },

  async defi_overview(args, ctx, _log) {
    const data = await ctx.api.defiOverview();
    return JSON.stringify(data ?? { error: 'DeFi data unavailable' });
  },

  async market_sentiment(args, ctx, _log) {
    const data = await ctx.api.marketSentiment();
    return JSON.stringify(data ?? { error: 'Sentiment data unavailable' });
  },

  async oracle_prices(args, ctx, _log) {
    const data = await ctx.api.oraclePrices();
    return JSON.stringify(data ?? { error: 'Oracle data unavailable' });
  },

  async token_info(args, ctx, _log) {
    if (!args.mint) return JSON.stringify({ error: 'mint required' });
    const data = await ctx.api.tokenInfo(args.mint);
    return JSON.stringify(data ?? { error: 'Token info unavailable' });
  },

  async token_holders(args, ctx, _log) {
    if (!args.mint) return JSON.stringify({ error: 'mint required' });
    const data = await ctx.api.tokenHolders(args.mint);
    return JSON.stringify(data ?? { error: 'Holder data unavailable' });
  },

  async token_chart(args, ctx, _log) {
    if (!args.mint) return JSON.stringify({ error: 'mint required' });
    const data = await ctx.api.tokenOhlcv(args.mint, args.timeframe ?? '1H', args.limit ?? 24);
    return JSON.stringify(data ?? { error: 'OHLCV data unavailable' });
  },

  async get_news(args, ctx, _log) {
    const data = await ctx.api.news({ limit: args.limit ?? 10, filter: args.filter ?? 'rising' });
    return JSON.stringify(data ?? { error: 'News unavailable' });
  },

  async top_pools(args, ctx, _log) {
    const data = await ctx.api.topPools(args.limit ?? 20);
    return JSON.stringify(data ?? { error: 'Pool data unavailable' });
  },
};

module.exports = { DEFINITIONS, HANDLERS };
