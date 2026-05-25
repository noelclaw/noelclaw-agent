# Configuration Reference

noelclaw uses a two-file config system. `config/agent.json` is the repo default — updated by `git pull`. Your personal overrides go in `config/agent.local.json`, which is gitignored and never touched by updates.

You only need to include the keys you want to change:

```json
// config/agent.local.json
{
  "llm": {
    "model": "MiniMax-M2.7",
    "minimaxKey": "sk-cp-..."
  },
  "strategy": {
    "entryBudgetEth": 0.002,
    "stopLossPct": -5
  },
  "telegram": {
    "token": "your-bot-token"
  }
}
```

---

## Trading Strategy

```json
{
  "strategy": {
    "scanIntervalMs": 300000,      // Scan frequency (default 5 min)
    "positionCheckMs": 10000,      // Monitor check interval (default 10s)
    "maxOpenPositions": 3,         // Max simultaneous positions
    "entryBudgetEth": 0.002,       // ETH per trade entry
    "minScanScore": 55,            // Min dip-reversal score to buy (0–100)
    "minLiquidity": 50000,         // Min pool liquidity in USD
    "stopLossPct": -6,             // Hard stop-loss %
    "takeProfitPct": 25,           // Take-profit %
    "maxHoldMinutes": 45,          // Max hold before forced exit
    "trailingStopActivatePct": 4,  // Trailing stop activates at +4%
    "trailingStopDistancePct": 3,  // Trails 3% below peak
    "buyCooldownMinutes": 60       // Skip re-entry on same mint for this long after exit
  }
}
```

## Risk

```json
{
  "risk": {
    "maxEntry1hDropPct": -15,  // Skip tokens with 1h drop worse than this
    "blacklist": [],           // Mint addresses to never trade
    "safeOnly": false          // Only trade GoPlus-verified-safe tokens
  }
}
```

## LLM

```json
{
  "llm": {
    "model": "MiniMax-M2.7",
    "provider": "minimax",      // "minimax" or "ollama"
    "baseUrl": "",              // Custom base URL (overrides provider default)
    "minimaxKey": ""            // Or set MINIMAX_API_KEY env var
  }
}
```

## Survival & Reinvest

```json
{
  "survival": {
    "minEthWarning": 0.003,  // Warn when ETH drops below this
    "minEthPause": 0.001,    // Pause new buys below this
    "noelclawReinvestPct": 0.25 // % of profit auto-converted to NOELCLAW (default 25%)
  }
}
```

## Agent Loop (LLM Strategy)

The agent loop runs every 90 minutes. It gives the LLM a market/performance brief and lets it set the session strategy for the next window.

```json
{
  "agentLoop": {
    "intervalMs": 5400000   // Strategy reasoning interval (default 90 min)
  }
}
```

**Session modes** the LLM can set:

| Mode | Behaviour |
|------|-----------|
| `active` | Scanner buys best scoring candidate automatically |
| `selective` | Each candidate passes through a quick LLM approve/reject gate before buying |
| `watchOnly` | Scanner runs and broadcasts signals but does not buy |

The LLM can also set a `patternFilter` (e.g. `["REVERSAL"]`), a `minScoreOverride`, and a `maxBuysThisSession` cap. Strategy is saved to `data/session_strategy.json` and expires after 90 min.

## Reflect & Heartbeat

```json
{
  "reflect": {
    "intervalMs": 14400000,  // Reflect cycle interval (default 4h)
    "autoApply": true        // Auto-apply config suggestions to agent.local.json
  },
  "heartbeat": {
    "intervalMs": 300000,       // Heartbeat message interval (default 5 min)
    "contextRefreshMs": 1800000 // How often to refresh ETH price + Fear & Greed cache (default 30 min)
  }
}
```

---

## Personality

Your agent's personality is defined in `soul.md`. To customize it:

```bash
cp soul.md soul.local.md   # Start from the default, then edit
```

`soul.local.md` is gitignored and replaces `soul.md` when present. Updates never touch it.

Similarly, `config/reflect.md` defines the reflect cycle prompt and can be freely edited.

---

## Config Presets

Three ready-to-use risk profiles live in `config/presets/`:

| Preset | Description |
|--------|-------------|
| `conservative.json` | Tight filters, small positions, safe-only tokens |
| `balanced.json` | Default settings — matches `config/agent.json` |
| `degen.json` | Looser filters, larger positions, wider stops |

To apply a preset, copy the relevant keys into `config/agent.local.json`.

---

## Dip-Reversal Scoring

The auto-scanner uses a 6-component scoring system (0–100):

| Component | Points | Signal |
|-----------|--------|--------|
| Drop depth | 0–25 | 1h must be negative — confirms a dip. Deeper = more room to bounce |
| Bounce confirmation | 0–20 | 5m price change ≥ 0.5% — reversal is starting |
| Sentiment shift | 0–15 | buyRatio5m − buyRatio1h — buyers returning after selloff |
| Buy pressure | 0–10 | Buy txns as % of 5m total — real demand |
| Volume & activity | 0–15 | 1h volume + 1h transaction count — validates bounce is real, not thin air |
| Trend alignment | −10 to +15 | 6h/24h direction — bonus for uptrend dips, penalty for death spirals |

**Hard gates** (all must pass before scoring):
- 1h price change must be negative
- 5m price change ≥ 0.5%
- Buy ratio > 50% (when ≥ 5 transactions in 5m)
- Liquidity ≥ minLiquidity
- Not a dead-cat: 6h AND 24h both ≤ −20% blocks entry

Patterns: `SHALLOW-DIP` (1h > −3%), `DIP-BUY` (−3% to −5%), `REVERSAL` (−5% to −10%), `DEEP-REVERSAL` (< −10%)

Before buying, the scanner also:
- Runs a rug check (GoPlus) on the top candidate
- Checks token_holders for whale concentration

---

## Environment Variables

All set in `.env` by the setup wizard. See `.env.example` for the full template.

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | EVM private key, hex encoded (generated by `init`) |
| `BASE_RPC_URL` | Base chain RPC endpoint URL |
| `MINIMAX_API_KEY` | MiniMax API key (cloud LLM) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `NOELCLAW_INTERNAL_KEY` | Internal key for self-hosted deployments |
