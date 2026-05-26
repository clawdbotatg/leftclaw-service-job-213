# CLAWD DCA V3

**Live URL:** https://bafybeicq5bjzu2cagqia5zplepzega5vx3qlbnlu7s6qm4d2zl6h5l76pa.ipfs.community.bgipfs.com/

A generalized, permissionless DCA (dollar-cost averaging) engine on Base mainnet.

Users create positions that auto-swap USDC into any Base token via Uniswap V3 on a fixed epoch schedule. Anyone can run the keeper to execute ripe positions and earn a fee. Protocol fees accumulate in USDC and can be permissionlessly burned by swapping into CLAWD.

## Live App

**[https://bafybeibvhsstmeqzxi2axhmkd5r7rzsbarzodnizzdlnmjbnllstaqsu2e.ipfs.community.bgipfs.com/](https://bafybeibvhsstmeqzxi2axhmkd5r7rzsbarzodnizzdlnmjbnllstaqsu2e.ipfs.community.bgipfs.com/)**

## Contract

- **Address**: [`0x096f3db3c7910061d798a2e2865844a24d13bf9c`](https://basescan.org/address/0x096f3db3c7910061d798a2e2865844a24d13bf9c)
- **Network**: Base mainnet (chain id 8453)
- **Verified**: Basescan ✓

## Frontend

The frontend is a Scaffold-ETH 2 Next.js static export deployed to IPFS via bgipfs. It provides four pages:

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

- **Smart contract**: `CLAWDdcaV3.sol` — Uniswap V3 DCA engine with epoch-based scheduling (3-hour epochs), per-position multi-hop swap paths, and 30 bps total fees (10 keeper + 10 protocol + 10 burn)
- **Security**: `Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`; CEI pattern throughout; per-position isolated execution via `try this.executeDCAFromBatch(positionId)`
- **Frontend**: Scaffold-ETH 2 (Next.js App Router, RainbowKit v2, wagmi, DaisyUI)
- **Hosting**: Decentralized via bgipfs (IPFS)
- **Framework**: Scaffold-ETH 2 with Foundry — see `AGENTS.md` for full agent guidance
