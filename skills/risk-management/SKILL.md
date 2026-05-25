# Skill: Risk Management

How to size positions, track portfolio heat, and protect capital.

## The one rule

**Never risk more than you can afford to lose on a single trade.** Everything else follows from this.

---

## Position sizing

### Default sizing
`entryBudgetEth` is your fixed position size. Default 0.002 ETH.

That's it. No dynamic sizing needed at the beginner level — fixed size + stop-loss = bounded risk per trade.

### Calculating max loss per trade
```
maxLossEth = entryBudgetEth × |stopLossPct| / 100
```
Example: 0.002 ETH entry × 6% stop = 0.00012 ETH max loss per trade (~$0.30 at ETH=$2500)

### When to scale up
Only scale `entryBudgetEth` up when:
1. Win rate > 50% over ≥20 trades
2. ETH balance > 10× the new position size
3. Market regime is Bull or Ranging (not Bear or Crash)

### When to scale down
Scale to minimum (0.002 ETH) immediately if:
- 3 consecutive stop-losses in the same session
- ETH balance drops below 5× `entryBudgetEth`
- Market regime turns Bear or Crash

---

## Portfolio heat

**Heat** = total capital currently at risk across all open positions.

```
heat = sum(entryBudgetEth per position) / ETH_balance × 100
```

| Heat | Meaning | Action |
|------|---------|--------|
| < 10% | Cold — room to trade | Normal operation |
| 10–20% | Warm — moderate exposure | OK, be selective |
| 20–40% | Hot — watch closely | No new entries until one closes |
| > 40% | Danger — overexposed | Exit weakest position immediately |

With `maxOpenPositions: 3` and `entryBudgetEth: 0.002` on a 0.05 ETH balance, max heat is 12% — comfortable. You can add positions without overexposing.

---

## Max drawdown rules

### Session drawdown
If you lose more than 15% of your starting session balance in a single trading session → pause trading for that session.

Use `pause_trading` with reason "session drawdown limit hit".

### Weekly drawdown
If 7-day P&L (from `get_trade_history`) is worse than -25% of starting week balance → reduce `entryBudgetEth` by 50% and raise `minScanScore` by 10.

### Recovery mode
After hitting a drawdown limit:
1. Wait 24h before resuming full position size
2. Start with 50% normal size for the first 5 trades
3. Only return to full size once you're net positive for the week

---

## Correlation risk

Base meme coins are highly correlated — when ETH dumps, everything dumps together. This means:

- **Holding 3 positions is not 3× diversification.** It's 3× exposure to the same ETH price direction.
- **Never hold more than 2 positions in the same narrative** (e.g., 2 dog coins, 2 AI coins) — if one rugs on sentiment, the others will follow.
- **When ETH drops > 5% in 1h:** consider exiting all open positions rather than hitting 3 separate stop-losses. One decision beats three.

---

## Stop-loss discipline

Stop-losses are not suggestions. The monitor fires them automatically — never override them via `sell_token` to "give it more room."

Common mistake: moving your mental stop from -6% to -10% after a position goes to -5%. The rule exists because tokens that fall 6% often fall 20% and never recover.

If you find yourself wanting to override the stop: **that's the signal to exit, not hold.**

---

## ETH survival as risk management

Your ETH balance is your operational capital — it funds every trade. If it drops too low, trading stops.

Risk-manage your ETH balance:
- ETH < 0.005 → load `survival` skill immediately
- NOELCLAW auto-reinvest (25% of wins) is a compounding layer — don't disable it

Treat `noelclawReinvestPct: 0.25` (25% of every win goes to NOELCLAW) as a compounding feature, not overhead.

---

## Quick risk audit (run during reflect)

Answer these from `get_trade_history`:
1. Win rate < 40%? → Raise `minScanScore` by 5, raise `minLiquidity` by 25%
2. Avg loss > 2× avg win? → Stop-loss is firing correctly but entries are bad — raise score threshold
3. Max hold firing > 30% of exits? → Market lacks follow-through — shorten `maxHoldMinutes` to 30
4. ETH balance declining week over week? → You are losing more than you're winning. Stop and diagnose before trading more.

---

## Tools to use for risk checks

- `get_trade_history` — P&L, win rate, exit breakdown
- `check_wallet` — current ETH balance and heat calculation
- `oracle_prices` — ETH/BTC direction (macro context)
- `market_sentiment` — Fear & Greed (< 30 = extreme fear, pause new entries)
- `pause_trading(reason, minutes)` — enforce drawdown limits programmatically
