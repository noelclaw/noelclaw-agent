// lib/tools/trading.js — trade execution tool definitions and handlers for Base chain
// Tools: check_wallet, buy_token, sell_token, send_token, pause_trading, resume_trading
'use strict';

const { ethers } = require('ethers');
const { loadIdentity } = require('../profile');

// Fire-and-forget swarm signal publish. Errors never block a trade.
async function _publishSwarmSignal(api, type, opts = {}) {
  const { agentId, address } = loadIdentity();
  if (!agentId && !address) return;
  await api.swarmPublish({
    agentId,
    address,
    type,
    mint:       opts.mint       ?? undefined,
    symbol:     opts.symbol     ?? undefined,
    confidence: opts.confidence ?? 0.7,
    data:       opts.data       ?? {},
  });
}

const DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'check_wallet',
      description: 'Check your agent wallet: ETH balance, CIRCUIT balance, and all open trading positions with current P&L.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buy_token',
      description: 'Buy a Base chain ERC-20 token using ETH via Uniswap v3. Execute autonomously based on your analysis — no user confirmation needed. Returns transaction hash on success.',
      parameters: {
        type: 'object',
        properties: {
          mint:      { type: 'string', description: 'Token contract address to buy (EVM hex address)' },
          solAmount: { type: 'number', description: 'Amount of ETH to spend (e.g. 0.001)' },
        },
        required: ['mint', 'solAmount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sell_token',
      description: 'Sell a held ERC-20 token position back to ETH via Uniswap v3 on Base. Execute autonomously based on your analysis — no user confirmation needed. Returns transaction hash on success.',
      parameters: {
        type: 'object',
        properties: {
          mint: { type: 'string', description: 'Token contract address to sell' },
          pct:  { type: 'number', description: 'Fraction to sell: 1.0 = 100%, 0.5 = 50% (default 1.0)' },
        },
        required: ['mint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_token',
      description: 'Send ERC-20 tokens directly from your wallet to another EVM address on Base. Use this to transfer CIRCUIT or any other held token to swarm agents or other wallets. Returns transaction hash on success.',
      parameters: {
        type: 'object',
        properties: {
          mint:      { type: 'string', description: 'Token contract address (EVM hex, e.g. CIRCUIT token)' },
          toAddress: { type: 'string', description: 'Destination EVM wallet address (0x...)' },
          amount:    { type: 'number', description: 'Amount to send in token UI units (e.g. 1000 for 1000 CIRCUIT)' },
        },
        required: ['mint', 'toAddress', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_trading',
      description: 'Pause the auto-scanner from making new buys. The position monitor keeps running — existing positions are still watched and exits still fire. Use when the user wants to stop new entries temporarily or when market conditions are too risky.',
      parameters: {
        type: 'object',
        properties: {
          reason:  { type: 'string', description: 'Why you are pausing (e.g. "bear market", "user request", "high volatility")' },
          minutes: { type: 'number', description: 'Auto-resume after this many minutes. Omit to pause until manually resumed.' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_trading',
      description: 'Resume the auto-scanner after a pause. Call this when the user wants to re-enable new buy entries.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const HANDLERS = {
  async check_wallet(_args, ctx, _log) {
    const { wallet, positions } = ctx;
    const [balances, held] = await Promise.all([
      wallet.getBalances(),
      Promise.resolve(positions.getAll()),
    ]);
    const positionList = Object.values(held).map(p => ({
      symbol:     p.symbol,
      mint:       p.mint,
      ethSpent:   p.solSpent,
      peakPnlPct: p.peakPnlPct,
      heldMins:   Math.round(positions.holdMinutes(p)),
      entryTime:  p.entryTime,
    }));
    return JSON.stringify({
      eth:           balances.eth,
      circuit:       balances.circuit,
      address:       balances.address,
      openPositions: positionList.length,
      positions:     positionList,
    });
  },

  async buy_token(args, ctx, log) {
    const { mint, solAmount } = args;
    const { api, swap, positions } = ctx;
    if (!mint || !solAmount) return JSON.stringify({ error: 'mint and solAmount required' });

    // One buy per processor round
    if (ctx._buyExecutedThisRound) {
      log('warn', 'buy_token blocked — already executed a buy this round');
      return JSON.stringify({ error: 'One buy per conversation round. A buy was already executed this session turn. Review the position and decide in the next message.' });
    }

    log('info', `Tool: buy_token ${mint.slice(0, 10)} ${solAmount} ETH`);

    // Hard blacklist gate — enforced regardless of LLM reasoning
    try {
      const bl = await api.blacklistCheck(mint);
      if (bl?.blacklisted) {
        log('warn', `buy_token blocked — mint on swarm blacklist`, { mint: mint.slice(0, 10), votes: bl.votes });
        return JSON.stringify({ error: `Buy blocked: ${mint.slice(0, 10)} is on the swarm blacklist (${bl.votes ?? '?'} votes). Do not buy this token.` });
      }
    } catch { /* blacklist unavailable — proceed; scanner pre-filters */ }

    const result = await swap.buy(mint, solAmount);

    // Get decimals from token contract
    let tokenDecimals = 18;
    try {
      const bal = await swap.getTokenBalance(mint);
      if (bal.decimals > 0) tokenDecimals = bal.decimals;
    } catch (_) {}

    positions.openPosition(mint, {
      symbol:        args.symbol ?? mint.slice(0, 8),
      entryPrice:    result.pricePerToken ?? 0,
      solSpent:      result.inAmount,
      tokenAmount:   result.outAmount,
      tokenDecimals,
      txSig:         result.txSig,
    });

    _publishSwarmSignal(api, 'buy_signal', {
      mint, symbol: args.symbol,
      confidence: 0.75,
      data: { entryBudgetEth: result.inAmount, txSig: result.txSig },
    }).catch(() => {});

    ctx._buyExecutedThisRound = true;
    return JSON.stringify({
      success:   true,
      txSig:     result.txSig,
      ethSpent:  result.inAmount,
      tokensOut: result.outAmount,
      mint,
    });
  },

  async sell_token(args, ctx, log) {
    const { mint, pct = 1.0, reason = 'manual' } = args;
    const { api, swap, positions } = ctx;
    if (!mint) return JSON.stringify({ error: 'mint required' });
    log('info', `Tool: sell_token ${mint.slice(0, 10)} ${(pct * 100).toFixed(0)}%`);

    const pos = positions.get(mint);
    if (!pos) return JSON.stringify({ error: 'No open position for this mint' });

    const bal = await swap.getTokenBalance(mint);
    if (!bal.rawAmount || bal.rawAmount === 0n) {
      return JSON.stringify({ error: 'Token balance is zero or unavailable — position may already be closed or RPC is lagging. Check status before retrying.' });
    }

    const rawBalance = Number(bal.rawAmount);
    const result = await swap.sell(mint, rawBalance, pct);

    let pnlPct = null;
    if (pct >= 1.0) {
      const pnlEth = (result.solReceived ?? 0) - pos.solSpent;
      pnlPct       = (pnlEth / pos.solSpent) * 100;
      positions.closePosition(mint, {
        solReceived: result.solReceived,
        pnlSol:      pnlEth,
        pnlPct,
        reason,
        txSig:       result.txSig,
      });

      _publishSwarmSignal(api, 'sell_signal', {
        mint, symbol: pos.symbol,
        confidence: 0.9,
        data: {
          pnlPct:  +pnlPct.toFixed(2),
          pnlEth:  +(((result.solReceived ?? 0) - pos.solSpent)).toFixed(6),
          reason,
          txSig:   result.txSig,
        },
      }).catch(() => {});
    } else {
      // Partial sell — update stored tokenAmount for remaining balance
      const soldRaw   = Math.floor(rawBalance * pct);
      const remaining = rawBalance - soldRaw;
      positions.updateTokenAmount(mint, remaining);
    }

    return JSON.stringify({
      success:     true,
      txSig:       result.txSig,
      ethReceived: result.solReceived,
      mint,
      soldPct:     pct,
      pnlPct,
    });
  },

  async send_token(args, ctx, log) {
    const { mint, toAddress, amount } = args;
    const { wallet } = ctx;

    if (!mint || !toAddress || amount == null) {
      return JSON.stringify({ error: 'mint, toAddress, and amount are required' });
    }
    if (amount <= 0) return JSON.stringify({ error: 'amount must be greater than zero' });

    // Validate destination address
    if (!ethers.isAddress(toAddress)) {
      return JSON.stringify({ error: `Invalid EVM address: ${toAddress}` });
    }
    if (toAddress.toLowerCase() === wallet.address.toLowerCase()) {
      return JSON.stringify({ error: 'Cannot send tokens to yourself' });
    }

    const ERC20_ABI = [
      'function transfer(address to,uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
    ];

    const tokenContract = new ethers.Contract(mint, ERC20_ABI, wallet.signer);
    let decimals;
    try {
      decimals = await tokenContract.decimals();
    } catch (e) {
      return JSON.stringify({ error: `Cannot fetch token decimals: ${e.message}` });
    }

    const rawAmount = ethers.parseUnits(String(amount), decimals);

    log('info', `Tool: send_token ${amount} → ${toAddress.slice(0, 10)}…`, { mint: mint.slice(0, 10) });

    try {
      const tx      = await tokenContract.transfer(toAddress, rawAmount);
      const receipt = await tx.wait();
      return JSON.stringify({ success: true, txSig: receipt.hash, mint, toAddress, amount });
    } catch (e) {
      return JSON.stringify({ error: `Transaction failed: ${e.message}` });
    }
  },

  async pause_trading(args, _ctx, _log) {
    const { pauseTrading } = require('../pause');
    const state = pauseTrading(args.reason ?? 'agent request', args.minutes ?? null);
    const msg = args.minutes
      ? `Trading paused for ${args.minutes} minutes (auto-resumes at ${new Date(state.until).toUTCString()}). Monitor still running — existing positions are watched.`
      : `Trading paused (${args.reason}). Call resume_trading to re-enable new buys. Monitor still running.`;
    return JSON.stringify({ paused: true, ...state, message: msg });
  },

  async resume_trading(_args, _ctx, _log) {
    const { resumeTrading, pauseStatus } = require('../pause');
    const was = pauseStatus();
    resumeTrading();
    return JSON.stringify({ paused: false, message: was.paused ? 'Trading resumed — auto-scanner will buy on next scan cycle.' : 'Trading was not paused.' });
  },
};

module.exports = { DEFINITIONS, HANDLERS };
