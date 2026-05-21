# CLAWD DCA V3

A generalized, permissionless DCA (dollar-cost averaging) engine on Base mainnet.

Users create positions that auto-swap USDC into any Base token via Uniswap V3 on a fixed epoch schedule. Anyone can run the keeper to execute ripe positions and earn a fee. Protocol fees accumulate in USDC and can be permissionlessly burned by swapping into CLAWD.

## Contract

- **Address**: `0x096f3db3c7910061d798a2e2865844a24d13bf9c`
- **Network**: Base mainnet (chain id 8453)

## Frontend

The frontend is a Scaffold-ETH 2 Next.js app located in `packages/nextjs`. It provides four pages:

- `/` — create a new DCA position (target token, multi-hop swap path, amount, interval, slippage)
- `/positions` — view and manage your active positions; withdraw accrued tokens or close
- `/keeper` — execute ripe positions individually or as a batch
- `/burn` — trigger the permissionless burn of accumulated protocol USDC into CLAWD

### Build

```bash
cd packages/nextjs
yarn build
```

The static export is written to `packages/nextjs/out/`.

## Architecture

Scaffold-ETH 2 with Foundry — see `AGENTS.md` for full agent guidance.
