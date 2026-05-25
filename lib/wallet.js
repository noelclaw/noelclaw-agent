// lib/wallet.js — EVM wallet management for circuit-agent on Base
// Loads EVM wallet from PRIVATE_KEY env var (hex private key).
// Tracks ETH + CIRCUIT (ERC-20) balances.
// Falls back to public Base RPCs when the primary hits rate limits.
'use strict';

const { ethers } = require('ethers');

const { CIRCUIT_MINT } = require('./circuit');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [WALLET] [${level.toUpperCase()}] ${line}\n`);
};

// Public Base RPC fallbacks used when the primary hits its rate limit.
const FALLBACK_RPCS = [
  'https://mainnet.base.org',
  'https://base.drpc.org',
];

const isRateLimited = (err) =>
  err.message.includes('429') ||
  err.message.includes('Too Many Requests') ||
  err.message.includes('max usage');

class WalletManager {
  constructor(rpcUrl, privateKeyHex) {
    this.provider  = new ethers.JsonRpcProvider(rpcUrl);
    this.fallbacks = FALLBACK_RPCS.map(u => new ethers.JsonRpcProvider(u));
    this.signer    = new ethers.Wallet(privateKeyHex, this.provider);
    this.address   = this.signer.address;
    this.publicKey = this.address; // alias for compatibility
    log('info', 'Wallet loaded', { address: this.address.slice(0, 10) + '…' });
  }

  // Tries the primary RPC first; on 429 falls through each fallback in order.
  async _withFallback(fn) {
    const providers = [this.provider, ...this.fallbacks];
    let lastErr;
    for (const provider of providers) {
      try {
        return await fn(provider);
      } catch (err) {
        lastErr = err;
        if (!isRateLimited(err)) throw err;
        log('warn', 'RPC rate limited — trying fallback');
      }
    }
    throw lastErr;
  }

  // ── ETH balance ──────────────────────────────────────────────────────────────

  async getEthBalance() {
    try {
      return await this._withFallback(async (provider) => {
        const balWei = await provider.getBalance(this.address);
        return parseFloat(ethers.formatEther(balWei));
      });
    } catch (err) {
      log('warn', 'getEthBalance failed', { error: err.message });
      throw err;
    }
  }

  // Alias so modules that call getSolBalance() still work without changes.
  async getSolBalance() {
    return this.getEthBalance();
  }

  // ── CIRCUIT balance (ERC-20) ─────────────────────────────────────────────────

  async getCircuitBalance() {
    try {
      return await this._withFallback(async (provider) => {
        if (!CIRCUIT_MINT || CIRCUIT_MINT.startsWith('CIRC_')) return 0;
        const contract = new ethers.Contract(CIRCUIT_MINT, ERC20_ABI, provider);
        const [balance, decimals] = await Promise.all([
          contract.balanceOf(this.address),
          contract.decimals(),
        ]);
        return parseFloat(ethers.formatUnits(balance, decimals));
      });
    } catch (err) {
      log('warn', 'CIRCUIT balance check failed', { error: err.message });
      return 0;
    }
  }

  // ── All balances snapshot ────────────────────────────────────────────────────

  async getBalances() {
    const [eth, circuit] = await Promise.all([
      this.getEthBalance(),
      this.getCircuitBalance(),
    ]);
    return { sol: eth, eth, circuit, address: this.address };
  }

  // ── Summary log ──────────────────────────────────────────────────────────────

  async logBalances() {
    const b = await this.getBalances();
    log('info', 'Balances', {
      eth:     b.eth.toFixed(6) + ' ETH',
      circuit: b.circuit.toLocaleString() + ' NOELCLAW',
    });
    return b;
  }

  // ── Check minimum balances ───────────────────────────────────────────────────

  async checkMinimums(cfg) {
    const b = await this.getBalances();
    const warnings = [];

    const minEthWarn  = cfg.survival?.minEthWarning ?? cfg.survival?.minSolWarning ?? 0.005;
    const minCircuit  = cfg.circuit?.minCircuitBalance ?? 5000;

    if (b.eth < minEthWarn) {
      warnings.push(`LOW ETH: ${b.eth.toFixed(6)} ETH — agent needs ETH for tx fees and trades`);
    }
    if (b.circuit < minCircuit) {
      warnings.push(`LOW NOELCLAW: ${b.circuit.toLocaleString()} — top up to pay for API calls`);
    }
    return { balances: b, warnings };
  }
}

// ── Load from env ────────────────────────────────────────────────────────────

function loadWallet(rpcUrl) {
  const key = process.env.PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'PRIVATE_KEY env var not set.\n' +
      'Set it to your EVM hex private key:\n' +
      '  export PRIVATE_KEY="0x..."\n' +
      'Or add it to your .env file.',
    );
  }
  const w = new WalletManager(rpcUrl, key);
  // Scrub the raw key from process.env so it can\'t be leaked via tools or prompt injection.
  delete process.env.PRIVATE_KEY;
  return w;
}

module.exports = { WalletManager, loadWallet };
