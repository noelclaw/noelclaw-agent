// lib/circuit.js — CIRCUIT Data API client for Base chain
// Handles x402 CIRCUIT payment automatically:
//   1. Checks /api/quote for current endpoint cost
//   2. Transfers CIRCUIT ERC-20 to treasury
//   3. Calls endpoint with X-Payment-Signature header
// If API_BASE is localhost + INTERNAL_KEY set → bypasses payment (dev/same-server mode).
'use strict';

process.stdout.on('error', e => { if (e.code !== 'EPIPE') throw e; });

const { ethers } = require('ethers');

// CIRCUIT ERC-20 token address on Base — update when deployed
const CIRCUIT_MINT    = 'CIRC_TOKEN_ADDRESS_ON_BASE_TBD';
const CIRCUIT_DECIMALS = 6;

const ERC20_ABI = [
  'function transfer(address to,uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ── Cache ─────────────────────────────────────────────────────────────────────
let _quoteCache = null;
let _quoteTsMs  = 0;
const QUOTE_TTL = 60_000; // 1 minute

// ── Logger ────────────────────────────────────────────────────────────────────
const log = (level, msg, data = {}) => {
  const ts   = new Date().toISOString();
  const line = Object.keys(data).length ? `${msg} ${JSON.stringify(data)}` : msg;
  process.stdout.write(`[${ts}] [CIRCUIT] [${level.toUpperCase()}] ${line}\n`);
};

class CircuitClient {
  /**
   * @param {object} opts
   *   baseUrl     {string}         — API base URL (default: https://api.circuitllm.dev)
   *   internalKey {string}         — X-Internal-Key for localhost bypass (self-hosted only)
   *   wallet      {object|null}    — { signer } ethers.Wallet — needed if actually paying
   */
  constructor(opts = {}) {
    this.baseUrl     = (opts.baseUrl ?? 'https://api.circuitllm.dev').replace(/\/$/, '');
    this.internalKey = opts.internalKey ?? '';
    this.wallet      = opts.wallet ?? null; // { signer }
    this._isLocal    = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
  }

  // ── Fetch helpers ────────────────────────────────────────────────────────────

  async _fetch(path, extraHeaders = {}) {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      signal:  AbortSignal.timeout(15_000),
    });
    return resp;
  }

  // ── Quote ────────────────────────────────────────────────────────────────────

  async getQuote() {
    if (_quoteCache && Date.now() - _quoteTsMs < QUOTE_TTL) return _quoteCache;
    const resp = await this._fetch('/api/quote');
    if (!resp.ok) throw new Error(`Quote ${resp.status}`);
    _quoteCache = await resp.json();
    _quoteTsMs  = Date.now();
    return _quoteCache;
  }

  // ── Call endpoint ────────────────────────────────────────────────────────────

  /**
   * Call a gated endpoint, handling payment automatically.
   * @param {string} endpointKey  — matches keys in /api/quote (e.g. 'scan', 'token-price')
   * @param {string} queryString  — e.g. '?mint=0x...&limit=20'
   * @returns {object} parsed JSON response
   */
  async call(endpointKey, queryString = '') {
    const path = `/api/${endpointKey}${queryString}`;

    // ── Localhost bypass ───────────────────────────────────────────────────────
    if (this._isLocal && this.internalKey) {
      const resp = await this._fetch(path, { 'X-Internal-Key': this.internalKey });
      if (resp.ok) return resp.json();
      if (resp.status !== 402) throw new Error(`API ${resp.status} on ${path}`);
    }

    // ── First attempt without payment (might be cached server-side) ────────────
    const first = await this._fetch(path);
    if (first.ok) return first.json();
    if (first.status !== 402) throw new Error(`API ${first.status} on ${path}`);

    // ── Need to pay ────────────────────────────────────────────────────────────
    if (!this.wallet) throw new Error('Payment required but no wallet configured');

    const quote   = await this.getQuote();
    const epInfo  = quote.endpoints?.[endpointKey];
    if (!epInfo) throw new Error(`Unknown endpoint: ${endpointKey}`);

    const circuitRaw = BigInt(epInfo.circuitRaw);
    const treasury   = quote.payment.treasury;

    log('info', `Paying ${epInfo.circuitRequired} for ${endpointKey}`, { usd: epInfo.usdPrice });

    const txHash = await this._sendCircuitPayment(treasury, circuitRaw);
    log('info', 'Payment sent', { txHash: txHash.slice(0, 18) + '…' });

    // ── Retry with signature ───────────────────────────────────────────────────
    const paid = await this._fetch(path, { 'X-Payment-Signature': txHash });
    if (paid.ok) return paid.json();
    const errBody = await paid.json().catch(() => ({}));
    throw new Error(`Paid API call failed ${paid.status}: ${errBody.error ?? ''}`);
  }

  // ── CIRCUIT balance check ─────────────────────────────────────────────────────

  async _getCircuitBalance() {
    if (!this.wallet) return 0;
    const { signer } = this.wallet;
    if (!CIRCUIT_MINT || CIRCUIT_MINT.startsWith('CIRC_')) return 0;
    try {
      const contract = new ethers.Contract(CIRCUIT_MINT, ERC20_ABI, signer.provider);
      const [balance, decimals] = await Promise.all([
        contract.balanceOf(signer.address),
        contract.decimals(),
      ]);
      return parseFloat(ethers.formatUnits(balance, decimals));
    } catch {
      return 0;
    }
  }

  // ── ERC-20 CIRCUIT transfer ───────────────────────────────────────────────────

  async _sendCircuitPayment(treasuryAddress, amountRaw) {
    const { signer } = this.wallet;
    if (!CIRCUIT_MINT || CIRCUIT_MINT.startsWith('CIRC_')) {
      throw new Error('CIRCUIT token address on Base not configured (CIRCUIT_MINT placeholder)');
    }
    const contract = new ethers.Contract(CIRCUIT_MINT, ERC20_ABI, signer);
    const tx       = await contract.transfer(treasuryAddress, amountRaw);
    const receipt  = await tx.wait();
    // Brief wait for RPC propagation before server-side verification
    await new Promise(r => setTimeout(r, 2000));
    return receipt.hash;
  }

  // ── Convenience methods ───────────────────────────────────────────────────────

  async scan(opts = {}) {
    const { limit = 20, minLiquidity = 10000, safeOnly = false } = opts;
    return this.call('scan', `?limit=${limit}&minLiquidity=${minLiquidity}&safeOnly=${safeOnly}`);
  }

  async tokenPrice(mint) {
    return this.call('token-price', `?mint=${mint}`);
  }

  async tokenPrices(mints) {
    if (!Array.isArray(mints) || !mints.length) throw new Error('mints array required');
    return this.call('token-prices', `?mints=${mints.join(',')}`);
  }

  async tokenInfo(mint) {
    return this.call('token-info', `?mint=${mint}`);
  }

  async marketOverview() {
    return this.call('market-overview');
  }

  async marketSentiment() {
    return this.call('market-sentiment');
  }

  async defiOverview() {
    return this.call('defi-overview');
  }

  async networkStats() {
    return this.call('network-stats');
  }

  async oraclePrices() {
    return this.call('oracle-prices');
  }

  async news(opts = {}) {
    const { limit = 10, filter = 'rising' } = opts;
    return this.call('news', `?limit=${limit}&filter=${filter}`);
  }

  async stakingYields() {
    return this.call('staking-yields');
  }

  async tokenOhlcv(mint, timeframe = '1H', limit = 24) {
    return this.call('token-ohlcv', `?mint=${mint}&timeframe=${timeframe}&limit=${limit}`);
  }

  async tokenHolders(mint) {
    return this.call('token-holders', `?mint=${mint}`);
  }

  async topPools(limit = 20) {
    return this.call('top-pools', `?limit=${limit}`);
  }

  async status() {
    const resp = await this._fetch('/api/status');
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    return resp.json();
  }

  // ── Swarm methods ─────────────────────────────────────────────────────────────

  async swarmPublish(opts = {}) {
    const resp = await fetch(`${this.baseUrl}/api/swarm/signal`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(opts),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`swarm/signal ${resp.status}: ${err.error ?? ''}`);
    }
    return resp.json();
  }

  async swarmOutcome(opts = {}) {
    const resp = await fetch(`${this.baseUrl}/api/swarm/outcome`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(opts),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`swarm/outcome ${resp.status}: ${err.error ?? ''}`);
    }
    return resp.json();
  }

  async swarmFeed(opts = {}) {
    const { limit = 50, type, mint, minReputation = 0 } = opts;
    let qs = `?limit=${limit}&minReputation=${minReputation}`;
    if (type) qs += `&type=${type}`;
    if (mint) qs += `&mint=${encodeURIComponent(mint)}`;
    return this._callSwarm('/api/swarm/feed' + qs, 'swarm-feed');
  }

  async swarmConsensus(mint) {
    if (!mint) throw new Error('mint required');
    return this._callSwarm(`/api/swarm/consensus/${mint}`, 'swarm-consensus');
  }

  async _callSwarm(path, endpointKey) {
    if (this._isLocal && this.internalKey) {
      const resp = await this._fetch(path, { 'X-Internal-Key': this.internalKey });
      if (resp.ok) return resp.json();
    }
    const resp = await this._fetch(path);
    if (resp.ok) return resp.json();
    if (resp.status !== 402) throw new Error(`API ${resp.status} on ${path}`);

    if (!this.wallet) throw new Error('Payment required but no wallet configured');
    const quote  = await this.getQuote();
    const epInfo = quote.endpoints?.[endpointKey];
    if (!epInfo) throw new Error(`Unknown endpoint: ${endpointKey}`);
    const txHash = await this._sendCircuitPayment(quote.payment.treasury, BigInt(epInfo.circuitRaw));
    const paid   = await this._fetch(path, { 'X-Payment-Signature': txHash });
    if (paid.ok) return paid.json();
    const errBody = await paid.json().catch(() => ({}));
    throw new Error(`Paid swarm call failed ${paid.status}: ${errBody.error ?? ''}`);
  }

  async swarmStats() {
    const resp = await this._fetch('/api/swarm/stats');
    if (!resp.ok) throw new Error(`swarm/stats ${resp.status}`);
    return resp.json();
  }

  async swarmLeaderboard(limit = 20) {
    const resp = await this._fetch(`/api/swarm/leaderboard?limit=${limit}`);
    if (!resp.ok) throw new Error(`swarm/leaderboard ${resp.status}`);
    return resp.json();
  }

  async swarmInsights(limit = 20) {
    return this._callSwarm(`/api/swarm/insights?limit=${limit}`, 'swarm-insights');
  }

  // ── Swarm task board ──────────────────────────────────────────────────────────

  async taskList(opts = {}) {
    const { status = 'open', type, limit = 20 } = opts;
    const params = new URLSearchParams({ status, limit: String(limit) });
    if (type) params.set('type', type);
    const resp = await this._fetch(`/api/swarm/tasks?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  }

  async _taskPost(endpoint, body) {
    const resp = await fetch(`${this.baseUrl}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    if (!resp.ok) data._status = resp.status;
    return data;
  }

  async taskPropose(agentId, address, opts = {}) {
    const { reward, ...rest } = opts;
    const rewardCircuit = parseInt(reward) || 0;

    let escrowTxSig = null;
    if (rewardCircuit > 0) {
      if (!this.wallet) {
        throw new Error(
          'Cannot propose a rewarded task without a wallet configured. ' +
          'Use reward: 0 for no-reward proposals.'
        );
      }

      const balance = await this._getCircuitBalance();
      if (balance < rewardCircuit) {
        throw new Error(
          `Insufficient CIRCUIT for task reward: ` +
          `have ${balance.toLocaleString()}, need ${rewardCircuit.toLocaleString()}. ` +
          `Top up your wallet or lower the reward.`
        );
      }

      const quote = await this.getQuote();
      const escrowWallet = quote.escrowWallet;
      if (!escrowWallet) {
        throw new Error(
          'This server does not have an escrow wallet configured. ' +
          'Rewarded tasks are unavailable — use reward: 0.'
        );
      }

      try {
        const amountRaw = BigInt(rewardCircuit) * BigInt(1_000_000); // 6 decimals
        log('info', `Depositing ${rewardCircuit.toLocaleString()} CIRCUIT to escrow for task reward`);
        escrowTxSig = await this._sendCircuitPayment(escrowWallet, amountRaw);
        log('info', `Escrow deposit confirmed`, { hash: escrowTxSig.slice(0, 18) + '…' });
      } catch (err) {
        throw new Error(`Escrow deposit failed: ${err.message}`);
      }
    }

    return this._taskPost('/api/swarm/tasks/propose', {
      agentId,
      address,
      reward: rewardCircuit || undefined,
      escrowTxSig,
      ...rest,
    });
  }

  async taskClaim(agentId, address, taskId) {
    return this._taskPost('/api/swarm/tasks/claim', { agentId, address, taskId });
  }

  async taskSubmit(agentId, address, taskId, work, summary) {
    return this._taskPost('/api/swarm/tasks/submit', { agentId, address, taskId, work, summary });
  }

  async taskAbandon(agentId, address, taskId, reason) {
    return this._taskPost('/api/swarm/tasks/abandon', { agentId, address, taskId, reason });
  }

  async pushAgentStats(agentId, address, statsPayload) {
    try {
      const resp = await fetch(`${this.baseUrl}/api/agents/stats`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.internalKey ? { 'X-Internal-Key': this.internalKey } : {}),
        },
        body:    JSON.stringify({ agentId, address, ...statsPayload }),
        signal:  AbortSignal.timeout(10_000),
      });
      return resp.ok ? resp.json() : { error: `HTTP ${resp.status}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  async getSwarmAgentStats() {
    const resp = await this._fetch('/api/agents/stats');
    if (!resp.ok) return null;
    return resp.json();
  }

  async taskCreateSubtask(params) {
    return this._taskPost('/api/swarm/tasks/subtask', params);
  }

  async getTaskSubtasks(taskId) {
    const resp = await this._fetch('/api/swarm/tasks/' + taskId + '/subtasks');
    if (!resp.ok) return null;
    return resp.json();
  }

  async getSwarmAggregateStats() {
    const resp = await this._fetch('/api/swarm/aggregate-stats');
    if (!resp.ok) return null;
    return resp.json();
  }

  async getSwarmHoldings() {
    const resp = await this._fetch('/api/swarm/holdings');
    if (!resp.ok) return null;
    return resp.json();
  }

  async getMarketRegime() {
    const resp = await this._fetch('/api/market-regime');
    if (!resp.ok) return null;
    return resp.json();
  }

  async taskVerify(agentId, address, taskId, approved, submissionId = null, comment = '') {
    return this._taskPost('/api/swarm/tasks/verify', {
      agentId, address, taskId, submissionId,
      approved: Boolean(approved),
      comment,
    });
  }

  // ── Swarm blacklist ───────────────────────────────────────────────────────────

  async blacklistGet(opts = {}) {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.limit)  params.set('limit', String(opts.limit));
    const resp = await this._fetch(`/api/swarm/blacklist?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  }

  async blacklistCheck(mint) {
    const resp = await this._fetch(`/api/swarm/blacklist/check/${mint}`);
    if (!resp.ok) return null;
    return resp.json();
  }

  async blacklistAdd(agentId, address, mint, symbol, reason) {
    const resp = await fetch(`${this.baseUrl}/api/swarm/blacklist`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agentId, address, mint, symbol, reason }),
    });
    return resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
  }
}

module.exports = { CircuitClient, CIRCUIT_MINT, TOKEN2022_PID: null };
