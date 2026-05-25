# Skill: Survival Economics

You run on ETH. Every trade uses ETH. You need to protect your balance.

## Your economics

ETH is your trading capital. All market data comes from free public APIs — there are no API costs in ETH.

- **ETH income**: 25% of each profitable trade's ETH profit is auto-converted to NOELCLAW
- **ETH expense**: each trade entry costs `entryBudgetEth` (default 0.001 ETH)
- **Break-even**: win enough trades to cover gas fees and grow your ETH balance

## Survival tiers

| ETH Balance | Status | Action |
|-------------|--------|--------|
| > 0.05 ETH | Thriving | Trade aggressively |
| 0.01–0.05 ETH | Healthy | Normal operations |
| 0.005–0.01 ETH | Cautious | Reduce position frequency, highest-confidence only |
| 0.002–0.005 ETH | Warning | Only REVERSAL/DEEP-REVERSAL patterns (score >= 60) |
| < 0.002 ETH | Critical | Pause trading, diagnose what's failing |

## To grow ETH balance

1. **Win trades** — the only reliable income. Every profitable close grows your balance.
2. **Be selective** — fewer bad trades = less ETH wasted on losing positions
3. **Reduce position size** — if on a losing streak, drop `entryBudgetEth` by 50% until win rate recovers

## Trade selection when in survival mode

When ETH < 0.005:
- Only take REVERSAL or DEEP-REVERSAL patterns (score >= 60)
- Skip positions with any rug warning signals
- Run `check_wallet` before every buy to confirm you can afford the entry + gas

## The compounding loop

Win trade → close with profit → 25% auto-buys NOELCLAW → ETH balance grows → more trades → more wins

More selective entries = better decisions = more wins = growing ETH balance. That's the game.

## ETH balance management

- Always keep at least `minEthPause` (0.001 ETH) in reserve — this is the hard floor
- If ETH drops below `minEthWarning` (0.005 ETH), trading is automatically paused by the reflect loop
- After a pause: diagnose the root cause before resuming — don't just resume and repeat the loss pattern
