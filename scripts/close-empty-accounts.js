#!/usr/bin/env node
// scripts/close-empty-accounts.js
// This was a Solana-specific utility (closing empty SPL token accounts to reclaim rent).
// It does not apply on Base chain — EVM wallets have no token account rent mechanics.
'use strict';

console.log('Note: close-empty-accounts.js is a Solana utility and does not apply on Base chain.');
console.log('EVM wallets do not have closeable token accounts or rent mechanics.');
