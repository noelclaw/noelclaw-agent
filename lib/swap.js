// lib/swap.js — Uniswap v3 swap execution for circuit-agent on Base
// Buy:  ETH → token via SwapRouter02 exactInputSingle (msg.value = ETH)
// Sell: token → ETH via multicall(exactInputSingle + unwrapWETH9)
// Tries fee tiers 3000 → 500 → 10000 until one succeeds.
'use strict';

const { ethers } = require('ethers');

// Uniswap v3 SwapRouter02 on Base mainnet
const SWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481';
// WETH on Base (same address as the canonical OP-stack WETH)
const WETH = '0x4200000000000000000000000000000000000006';

// Fee tiers to try in order: 0.3%, 0.05%, 1%
const FEE_TIERS = [3000, 500, 10000];

const ROUTER_ABI = [
  // ETH-in swap (send ETH as value, tokenIn = WETH)
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  // Batch multiple calls in one tx (used for token→ETH: swap + unwrap)
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  // Unwrap WETH held by router → send ETH to recipient
  'function unwrapWETH9(uint256 amountMinimum,address recipient) external payable',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];

const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [SWAP] [${level.toUpperCase()}] ${line}\n`);
};

class SwapExecutor {
  /**
   * @param {object} opts
   *   signer       — ethers.Wallet connected to a provider
   *   slippageBps  — default slippage in basis points (100 = 1%)
   */
  constructor(opts) {
    this.signer      = opts.signer;
    this.slippageBps = opts.slippageBps ?? 100;
    this.address     = this.signer.address;
    this.router      = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, this.signer);
  }

  // ── Buy: ETH → token ─────────────────────────────────────────────────────────

  /**
   * Buy a token using ETH via Uniswap v3.
   * @param {string} tokenAddress — ERC-20 token contract address
   * @param {number} ethAmount    — amount of ETH to spend
   * @returns {{ txSig, inAmount, outAmount, pricePerToken, mint }}
   */
  async buy(tokenAddress, ethAmount) {
    const ethWei = ethers.parseEther(String(ethAmount));
    log('info', 'Buy order', { token: tokenAddress.slice(0, 10) + '…', eth: ethAmount });

    let lastErr;
    for (const fee of FEE_TIERS) {
      try {
        const params = {
          tokenIn:           WETH,
          tokenOut:          tokenAddress,
          fee,
          recipient:         this.address,
          amountIn:          ethWei,
          amountOutMinimum:  0n,
          sqrtPriceLimitX96: 0n,
        };

        const tx      = await this.router.exactInputSingle(params, { value: ethWei });
        const receipt = await tx.wait();

        // Count tokens received via Transfer events emitted to our address
        const tokenIface   = new ethers.Interface(ERC20_ABI);
        let outAmount = 0n;
        for (const logEntry of receipt.logs) {
          try {
            const parsed = tokenIface.parseLog(logEntry);
            if (
              parsed?.name === 'Transfer' &&
              parsed.args.to.toLowerCase() === this.address.toLowerCase() &&
              logEntry.address.toLowerCase() === tokenAddress.toLowerCase()
            ) {
              outAmount += parsed.args.value;
            }
          } catch { /* not this event */ }
        }

        const ethSpent = parseFloat(ethers.formatEther(ethWei));
        log('info', 'Buy executed', {
          txHash:    receipt.hash.slice(0, 18) + '…',
          ethSpent:  ethSpent.toFixed(6),
          tokensOut: outAmount.toString(),
          fee,
        });

        return {
          txSig:         receipt.hash,
          inAmount:      ethSpent,
          outAmount:     outAmount.toString(), // BigInt string — preserves precision for 18-decimal tokens
          pricePerToken: Number(outAmount) > 0 ? ethSpent / Number(outAmount) : null,
          mint:          tokenAddress,
        };
      } catch (err) {
        lastErr = err;
        log('warn', `Buy fee=${fee} failed — trying next tier`, { error: err.message.slice(0, 100) });
      }
    }
    throw lastErr;
  }

  // ── Sell: token → ETH ────────────────────────────────────────────────────────

  /**
   * Sell a percentage of a held token position for ETH via Uniswap v3.
   * Uses multicall: exactInputSingle(token→WETH, recipient=router) + unwrapWETH9.
   * @param {string} tokenAddress — ERC-20 token contract address
   * @param {number} tokenAmount  — raw token amount (atomic units)
   * @param {number} pct         — fraction to sell (0–1, default 1 = 100%)
   * @returns {{ txSig, inAmount, outAmount, solReceived }}
   */
  async sell(tokenAddress, tokenAmount, pct = 1) {
    const sellAmount = BigInt(Math.floor(Number(tokenAmount) * pct));
    if (sellAmount === 0n) throw new Error('Sell amount is 0');

    log('info', 'Sell order', {
      token: tokenAddress.slice(0, 10) + '…',
      pct:   (pct * 100).toFixed(0) + '%',
    });

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);

    // Approve router if current allowance is insufficient
    const allowance = await tokenContract.allowance(this.address, SWAP_ROUTER);
    if (allowance < sellAmount) {
      log('info', 'Approving router for token spend…');
      const approveTx = await tokenContract.approve(SWAP_ROUTER, sellAmount);
      await approveTx.wait();
    }

    // Snapshot ETH balance before swap to compute exact ETH received
    const balBefore = await this.signer.provider.getBalance(this.address);

    let lastErr;
    for (const fee of FEE_TIERS) {
      try {
        // exactInputSingle: token → WETH, sent to router (so we can unwrap)
        const swapParams = {
          tokenIn:           tokenAddress,
          tokenOut:          WETH,
          fee,
          recipient:         SWAP_ROUTER, // router holds WETH until unwrap
          amountIn:          sellAmount,
          amountOutMinimum:  0n,
          sqrtPriceLimitX96: 0n,
        };

        const swapCalldata   = this.router.interface.encodeFunctionData('exactInputSingle', [swapParams]);
        const unwrapCalldata = this.router.interface.encodeFunctionData('unwrapWETH9', [0n, this.address]);

        const tx      = await this.router.multicall([swapCalldata, unwrapCalldata]);
        const receipt = await tx.wait();

        // Compute ETH received: balance delta + gas cost
        const balAfter   = await this.signer.provider.getBalance(this.address);
        const gasPrice   = receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n;
        const gasCost    = receipt.gasUsed * gasPrice;
        const ethReceived = Math.max(0, parseFloat(
          ethers.formatEther(balAfter - balBefore + gasCost)
        ));

        log('info', 'Sell executed', {
          txHash:      receipt.hash.slice(0, 18) + '…',
          ethReceived: ethReceived.toFixed(6),
          fee,
        });

        return {
          txSig:       receipt.hash,
          inAmount:    Number(sellAmount),
          outAmount:   Number(balAfter - balBefore + gasCost),
          solReceived: ethReceived,
        };
      } catch (err) {
        lastErr = err;
        log('warn', `Sell fee=${fee} failed — trying next tier`, { error: err.message.slice(0, 100) });
      }
    }
    throw lastErr;
  }

  // ── Get token balance ────────────────────────────────────────────────────────

  async getTokenBalance(tokenAddress) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer.provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(this.address),
        contract.decimals(),
      ]);
      return {
        rawAmount:  balance,
        uiAmount:   parseFloat(ethers.formatUnits(balance, decimals)),
        decimals:   Number(decimals),
        ataAddress: null, // no equivalent concept on EVM
      };
    } catch (err) {
      log('warn', 'Token balance check failed', { error: err.message });
      return { rawAmount: 0n, uiAmount: 0, decimals: 18, ataAddress: null };
    }
  }
}

// Export WETH as SOL_MINT alias so any remaining import of SOL_MINT still resolves.
module.exports = { SwapExecutor, SOL_MINT: WETH, WETH };
