# Skill: Yield Farming & DeFi

You are allocating idle capital into yield-generating positions on Base chain. This is a capital efficiency play — idle ETH earns nothing; deployed capital compounds.

## When to use this

- You have ETH sitting idle with no strong trade setups (scan score < 55 for all candidates)
- CIRCUIT balance is healthy (> 100k) and you want to compound without active trading
- Market is ranging or bearish and directional trades carry too much risk
- User asks about staking, yield, or passive income

## Yield options ranked by risk

### 1. Liquid Staking (lowest risk, lowest yield)

Swap ETH → LST on Base. These are 1:1 redeemable and hold their ETH peg well.

| Token | Approx APY | Contract (Base) |
|-------|-----------|------|
| cbETH | ~3-4% | 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22 |
| wstETH | ~3-4% | 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452 |
| rETH | ~3-4% | 0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c |

**When to use**: Bear market, no trade setups, ETH idle for >4h. Small position (never commit all ETH to LST — keep trading float).

**How**: Use `buy_token(mint, ethAmount)` to swap ETH → LST. Monitor with `token_price(mint)`.

### 2. LP Positions (medium risk, higher yield)

You can check top pools via `top_pools` — this shows where real volume and fees are flowing on Base (Uniswap v3, Aerodrome). Flag to user if they want to manually add liquidity.

When discussing LP with a user:
- Concentrated liquidity (Uniswap v3) = higher APY, higher impermanent loss risk
- ETH/USDC pools are safest (both assets you understand)
- Meme/volatile pairs: APY can be 100%+ but IL destroys you in a pump

### 3. Lending (medium risk, medium yield)

**Aave v3 on Base** — the dominant Base lending protocol. Users can deposit ETH or USDC and earn supply APY (typically 2-5% for ETH, 5-10% for stablecoins). You cannot directly interact with Aave's smart contracts in this agent version without the SDK.

**Flag to user**: If idle ETH > 0.01 ETH and no trades incoming, suggest Aave lending as an option.

### 4. CIRCUIT accumulation (strategic)

The `circuit-reinvest` module auto-converts 25% of trade profits to CIRCUIT. This is passive yield on wins — treat it as a compounding layer on top of trading.

## DeFi overview workflow

When a user asks about DeFi opportunities:

1. `defi_overview` — get current TVL by protocol, find where capital is flowing
2. `staking_yields` — compare current LST APYs before recommending one
3. `oracle_prices` — confirm ETH price trend before committing capital to LSTs
4. Recommend the best fit based on their risk tolerance and hold period

## Capital allocation rules

- **Never put all ETH into LSTs** — always keep minimum trading float (cfg.survival.minEthWarning + entry budget)
- **LST position sizing**: max 50% of idle ETH
- **Rebalance trigger**: If a strong dip-reversal score (>70) appears, sell LST → ETH → buy token
- **Track LST as a position**: Open a position entry for any LST purchase so you can monitor and exit

## Key numbers to check

- Current best LST APY: `staking_yields`
- Where liquidity is going: `top_pools` (volume leaders = real yield)
- Macro context before deploying: `market_sentiment` — if Fear & Greed < 25, great time for yield. If > 75, prioritize trading over yield.
