<div align="center">

# noelclaw

**An open-source autonomous trading agent for Base chain. Scans, buys, monitors, reflects, and earns — on its own. Extend it with custom tools, teach it new skills, or build on top of it.**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.3.0-blue)](https://github.com/noelclaw/noelclaw-agent/releases)
[![Status](https://img.shields.io/badge/status-beta-orange)](https://github.com/noelclaw/noelclaw-agent)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

> **Beta software.** noelclaw is under active development. Use small amounts until you're comfortable with how it behaves.

[Website](https://noelclaw.fun) · [X / Twitter](https://x.com/noelclaw) · [Telegram](https://t.me/noelagent_bot)

</div>

---

## What it does

- **Scans and trades** — dip-reversal scoring runs every 5 minutes, buys the best candidate on Base, monitors stops every 10s. No LLM in the hot path — deterministic and fast.
- **Self-tunes** — every 4 hours it reviews its own trade history, adjusts config within safe bounds, and stores lessons for future sessions.
- **Talks to you** — full Telegram interface: ask questions, request trades, check positions, trigger scans. Or use the CLI.
- **Free data, zero fees** — market data comes directly from DexScreener, GeckoTerminal, GoPlusLabs, CoinGecko, and DeFiLlama. No paid API, no third-party payments.
- **Extensible** — add tools, write skills, or drop in custom scripts. The agent can write and run its own code via the `builder` skill.
- **NOELCLAW token** — holds and tracks your NOELCLAW balance on Base. CA: `0x4B524015D54a27d4472F5c59c570730D69499Ba3`

---

## Before you start

| What | Why | Where to get it |
|------|-----|-----------------|
| **Node.js ≥ 18** | Runtime | [nodejs.org](https://nodejs.org) |
| **ETH on Base** | Pays for trades and gas | Any exchange → bridge to Base |
| **MiniMax API key** | Powers the LLM brain | [minimaxi.com](https://www.minimaxi.com) |

**Telegram bot** (recommended) — create one via [@BotFather](https://t.me/botfather).

---

## Quick Start

```bash
git clone https://github.com/noelclaw/noelclaw-agent
cd noelclaw-agent
npm install
node agent.js init
```

`init` generates a fresh EVM wallet on Base and walks you through setup (~2 minutes).

**Fund your wallet** — send at least **0.005 ETH on Base** to your wallet address before starting.

```bash
node agent.js start
```

---

## CLI Commands

```bash
node agent.js init        # First time: generate wallet + setup wizard
node agent.js start       # Start the full agent
node agent.js setup       # Re-run setup wizard
node agent.js wallet      # Show ETH + NOELCLAW balances
node agent.js status      # Show open positions + P&L
node agent.js scan        # Run one market scan, print top candidates
node agent.js send "..."  # Send a message through the LLM
node agent.js logs        # Recent activity: trades, scans, reflects
node agent.js logs 100    # More history (default: 50 lines)
node agent.js stop        # Stop the agent
```

---

## Telegram Commands

| Command | What it does |
|---------|-------------|
| `/wallet` | ETH + NOELCLAW balances |
| `/status` | Open positions + P&L |
| `/scan` | Run a market scan now |
| `/pause [minutes]` | Pause new buys |
| `/resume` | Re-enable new buys |
| `/reflect` | Trigger a reflect cycle now |
| `/reset` | Clear conversation history |
| `/help` | All commands |

Or just send any message — the LLM handles it.

---

## How it works

Five loops run in parallel. The LLM is only in the loop when it needs to be:

```
auto-scanner  (every 5 min)    Scan → filter → score → buy
position mon  (every 10s)      Price fetch → stops → sell
heartbeat     (every 5 min)    Status → exception detect → LLM if needed
agent-loop    (every 90 min)   LLM sets trading mode + score threshold
reflect       (every 4h)       LLM reviews trades → tunes config → saves lessons
```

**Auto-scanner** pulls trending tokens from DexScreener, strips anything already held or recently traded, then scores through a 6-component dip-reversal model (0–100). Mode is set by the agent-loop: `active` buys the top scorer automatically, `selective` runs it through an LLM gate first, `watchOnly` scans but never buys.

**Position monitor** fetches prices from DexScreener every 10 seconds and checks each open position against stop-loss, take-profit, trailing stop (activates at +4%, trails 3% below peak), and max-hold time. Sells go through Uniswap v3 on Base.

**Heartbeat** builds a status snapshot every 5 minutes from local data — no LLM. Sends positions, P&L, and wallet balances to Telegram. If it detects an exception (position near stop-loss, low ETH), it escalates to the LLM once with a 30-minute cooldown.

**Agent-loop** is the LLM strategy brain between reflect cycles. Every 90 minutes it reviews recent scan quality and market conditions and sets a session strategy: which patterns to target, what score threshold to require, how many buys to allow.

**Reflect** is the deep self-improvement cycle. Every 4 hours the LLM reviews full trade history, win rates by pattern, and whether its current config is working. It proposes config changes (auto-applied within safe bounds), saves lessons to persistent notes injected into every future prompt.

---

## Data Sources (all free)

| Source | Used for |
|--------|----------|
| [DexScreener](https://dexscreener.com) | Token scan, prices, pools, OHLCV |
| [GeckoTerminal](https://geckoterminal.com) | Trending Base pools |
| [GoPlusLabs](https://gopluslabs.io) | Rug analysis, token security |
| [CoinGecko](https://coingecko.com) | ETH/BTC oracle prices |
| [DeFiLlama](https://defillama.com) | Base TVL, staking yields |
| [Alternative.me](https://alternative.me/crypto/fear-and-greed-index) | Fear & Greed index |

No paid API subscription. No token payments to third parties. 100% free.

---

## Configuration

Two files, one rule: `config/agent.json` is the repo default. Your overrides go in `config/agent.local.json` — gitignored, never touched by updates.

```json
// config/agent.local.json — only include what you want to change
{
  "strategy": {
    "entryBudgetEth": 0.002,
    "stopLossPct": -5
  },
  "telegram": {
    "token": "your-bot-token"
  }
}
```

Three presets available in `config/presets/`: `conservative`, `balanced`, `degen`.

→ [Full configuration reference](docs/configuration.md)

---

## Personality

Your agent's identity is defined in `soul.md`. Customize it without touching the repo default:

```bash
cp soul.md soul.local.md   # Edit freely — gitignored, update-safe
```

---

## Skills

The agent loads specialized knowledge on demand. Ask it to `load skill <name>` in Telegram:

| Skill | Covers |
|-------|--------|
| `dip-reversal` | Entry scoring, gates, patterns |
| `momentum-trading` | Breakout entries, trend following |
| `scalping` | Sub-10min trades, tight stops |
| `exit-strategy` | Partial exits, managing winners |
| `risk-management` | Position sizing, drawdown rules |
| `market-analysis` | Regime reading, Fear & Greed |
| `yield-farming` | LST staking, Aave lending on Base |
| `rug-detection` | Token safety deep-dive |
| `noel-orchestrator` | Dynamic multi-agent coordination |
| `builder` | Writing and running custom scripts |

---

## NOELCLAW Token

| | |
|--|--|
| **Token** | NOELCLAW |
| **Contract** | `0x4B524015D54a27d4472F5c59c570730D69499Ba3` |
| **Network** | Base (ERC-20) |

---

## Keeping it running

`node agent.js start` runs in the foreground. For unattended deployment on Linux, use the included systemd service:

```bash
cp deploy/noelclaw.service ~/.config/systemd/user/noelclaw.service
# Edit WorkingDirectory to your install path, then:
systemctl --user enable --now noelclaw
loginctl enable-linger $USER   # keep running after logout
```

→ [Full deployment guide](docs/deployment.md)

---

## Updates

```bash
node scripts/update.js          # Preview what would change
node scripts/update.js --apply  # Apply safe updates
```

Your `.env`, `data/`, `soul.local.md`, and `config/agent.local.json` are never touched.

---

## Docs

- [Configuration reference](docs/configuration.md)
- [Deployment guide](docs/deployment.md)
- [Architecture](ARCHITECTURE.md)

---

## Links

- **Website:** [noelclaw.fun](https://noelclaw.fun)
- **X / Twitter:** [@noelclaw](https://x.com/noelclaw)
- **Telegram:** [@noelagent_bot](https://t.me/noelagent_bot)
- **Part of:** [Noelclaw AI OS](https://noelclaw.fun)
