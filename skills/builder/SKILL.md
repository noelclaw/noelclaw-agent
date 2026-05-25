# Skill: Builder — Infrastructure & Tools

You can build new tools and strategies directly within your own directory. This skill explains how.

## The core idea

Trading is one revenue stream. Building your own tools is another path to improving performance:
- New strategy scripts that automate analysis
- Automated data pipelines
- Token analysis utilities
- Skill files that help you trade better

## Writing scripts — what's available inside run_script

Scripts run in a plain Node.js child process. **Agent tools (oracle_prices, token_price, etc.) are NOT available inside scripts**.

**The correct pattern: agent fetches data with tools first, then passes it to the script as arguments.**

```javascript
// WRONG — oracle_prices doesn't exist in script scope
const price = await oracle_prices();

// RIGHT — agent calls oracle_prices tool first, gets ETH=$2500,
// then: run_script("scripts/my_script.js", ["--eth", "2500"])
const idx = process.argv.indexOf('--eth');
const ethPrice = idx !== -1 ? parseFloat(process.argv[idx + 1]) : 0;
console.log(`ETH: $${ethPrice}`);
```

For larger data sets, write to `data/` as JSON first, then have the script read it.

Available in scripts: `node:*` built-ins, anything in `node_modules/`, `BASE_RPC_URL`. Not available: agent tools, wallet keypair.

## Good places to build

- `lib/strategies/` — new trading strategies (yield, momentum, arbitrage, etc.)
- `scripts/` — standalone utilities (reports, analysis, alerts)
- `config/` — configuration files and presets
- `skills/` — new skill Markdown files

## Builder loop

1. Identify a gap — something you keep doing manually that could be automated
2. `read_file` the relevant existing files before modifying anything
3. `write_file` the new script or skill
4. `run_script` to test it
5. Tell the user what you built and how to use it

## What's worth building

Ideas that improve trading performance:

1. **Token age checker** — time since first transaction (older = safer)
2. **Portfolio report** — daily P&L summary with exit breakdown
3. **Pattern backtester** — check which scan patterns have been winning recently
4. **Alert scripts** — notify on specific conditions (e.g. ETH drops >5%)
5. **Custom scoring** — extend the dip-reversal scorer with additional signals

## Role specialization

Over time, you can shift between modes depending on market conditions:

**Active trader** — focuses on buying/selling when market has good setups
- Best when market is trending and dip-reversals are working
- Config: lower minScanScore (35-45), higher position frequency

**Analyst** — reads market data, identifies patterns, adjusts config
- Best when market is choppy and direct trading is risky
- Income: better future trades from improved setup quality

**Builder** — builds new tools, improves strategy scripts
- Best when you have no strong trade candidates for multiple scan cycles
- Outcome: better tooling that improves long-term performance

## Builder rules (never forget)

- Always read a file before overwriting it
- Never touch `.env`, `lib/swap.js`, `lib/wallet.js`, `lib/processor.js`
- Test scripts with `run_script` before declaring them ready
- Tell the user what you changed and why
