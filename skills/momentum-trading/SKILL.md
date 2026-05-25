# Skill: Momentum Trading

Momentum trading is different from dip-reversal. Instead of buying the dip and waiting for recovery, you chase breakouts — tokens with strong positive momentum across multiple timeframes.

## When to use this

Use momentum entries when:
- Market is in strong uptrend (ETH > 0% 24h, DeFi TVL rising)
- You have capital to deploy but no quality dip-reversals in scanner
- market_overview shows multiple tokens with strong positive momentum

## Momentum entry criteria

Unlike dip-reversal, momentum trades need **positive** 1h AND 5m:

| Signal | Threshold | Weight |
|--------|-----------|--------|
| 5m price change | > +2% | High |
| 1h price change | > +5% | High |
| 5m buy ratio | > 60% | High |
| 5m vs 1h buy ratio | 5m > 1h | Medium |
| Volume 1h | > $75k | Medium |
| 6h trend | > 0% | Bonus |
| market_overview trend | bullish | Bonus |

**Minimum to enter**: 5m > +2%, 1h > +5%, buy ratio > 60%, volume > $50k

## Risk differences vs dip-reversal

Momentum trades are riskier:
- You're buying into strength — price may already be near peak
- Stop-loss fires more often (less room between entry and stop)
- Take-profit should be lower (8-12% vs 25%) — momentum fades fast

**Config for momentum trades** (update via update_config):
```json
{
  "strategy": {
    "takeProfitPct": 10,
    "stopLossPct": -4,
    "maxHoldMinutes": 20,
    "trailingStopActivatePct": 3,
    "trailingStopDistancePct": 2
  }
}
```

Tighter parameters because you're buying at the top of a move, not the bottom.

## Momentum scoring (DIY — scanner doesn't score this natively)

When evaluating a scan result for momentum (not dip-reversal):

```
Score = 0
+ 25 pts if 5m > +5%
+ 15 pts if 5m +2-5%
+ 25 pts if buy ratio 5m > 65%
+ 10 pts if buy ratio 5m 60-65%
+ 20 pts if 1h > +10%
+ 10 pts if 1h +5-10%
+ 10 pts if 6h > 0%
+ 10 pts if market_overview shows broad bullish momentum
-20 pts if priceChange1h > +30% (already pumped, late)

Enter if score >= 55
```

## Entry discipline

1. Check swarm for rug_alert — hard skip if any
2. Check token_info risk — skip if DANGER
3. Confirm buy ratio trending up (5m > 1h)
4. Set tighter TP/SL before buying
5. Max position size: 0.0008 ETH (smaller than reversal — higher risk)

## Exit discipline

Momentum fades fast. Key rules:
- Take profit earlier than you think (10% not 25%)
- Trailing stop crucial — activate at +3%, trail at 2%
- If it stalls (flat for 5+ minutes from peak), manual sell
- Max hold: 20 min — momentum is either there or it isn't

## Macro filter

Before any momentum trade, check:
```
oracle_prices → ETH 24h change
```

If ETH is down > 5% in 24h, skip momentum trades entirely. Tokens pump less in bear macro.

## Confirming momentum entry

Strong momentum confirmation:
- scan_tokens returns score >= 55 for the token
- market_overview shows the token trending with high volume
- token_price shows buy ratio > 60% on 5m candle

Multiple signals aligned = strongest entry conviction. Enter within 2 scan cycles.
