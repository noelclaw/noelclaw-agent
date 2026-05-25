# Skill: Swarm Analyst

> **Note:** Swarm features (read_swarm_feed, get_swarm_consensus, publish_signal) are present as tool stubs but are no-ops in this deployment. This skill documents the signal types and patterns for reference, and describes how to use the available market tools as equivalent alternatives.

## What swarm tools do (when active)

Swarm tools allow agents to share buy/sell signals, rug alerts, and insights across instances. In the current noelclaw deployment, these tools are stubs — they return empty results rather than live swarm data.

**Equivalent alternatives using public tools:**

| Swarm tool | Public alternative |
|-----------|-------------------|
| read_swarm_feed (buy signals) | market_overview, scan_tokens |
| get_swarm_consensus | token_info, token_holders |
| swarm rug_alert | token_info verdict="danger" |
| market_regime signal | oracle_prices + market_sentiment |
| strategy_stats | get_trade_history (your own data) |

## Signal types (for future reference)

- `buy_signal` — agent bought or is about to buy (mint, score, pattern)
- `sell_signal` — agent sold (P&L, reason, hold time)
- `rug_alert` — rug detected (take seriously, act fast)
- `insight` — trading lesson or pattern observation
- `market_regime` — bull/bear/choppy read on current market

## Pre-buy research without swarm

Before buying any token, use these tools as your due diligence stack:

1. `token_info` — rug risk, LP lock, mint/freeze authority. DANGER = hard skip.
2. `token_holders` — concentration check. Top 5 holders > 60% = flag.
3. `market_sentiment` — Fear & Greed index. < 25 = extreme fear, be cautious.
4. `oracle_prices` — ETH macro direction. If ETH is dumping, memes dump harder.

## Reading market conditions

Without swarm feed, use these as your "what are other smart money participants doing" signals:

```
market_overview → trending tokens on DexScreener and GeckoTerminal
top_pools → where volume is flowing (high volume = active speculators)
get_news → breaking news that might drive token movements
oracle_prices → ETH/BTC direction (macro context)
```

## Publishing patterns (self-improvement only)

Since swarm publishing is inactive, use `save_note` to record your own patterns:

```
save_note(key="pattern_2026-05_reversal", value="REVERSAL pattern 65% win rate when ETH > 0% 24h and liquidity > 100k")
```

These notes inject into your system prompt on every session — effectively your personal swarm of remembered insights.

## Coordinated exit detection (alternative)

During a hold, instead of reading swarm sell signals, use:
```
token_price(mint) → check buy ratio
token_chart(mint) → check recent candles for distribution signals
```

If buy ratio falls below 45% and price is declining: exit early rather than waiting for stop-loss.
