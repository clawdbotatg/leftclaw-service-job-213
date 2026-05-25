# Feature Job #225 — Auto-routing via WETH

## Request
"We want our DCA contract to have auto-routing via WETH built into every swap automatically, not a manual thing the user has to add."

## Scope

### Contract: `packages/foundry/contracts/CLAWDdcaV3.sol`
- Extract the core of `createPosition` into `_createPositionFromPath` internal helper.
- Add `createPositionViaWETH(totalUSDC, amountPerSwap, intervalInEpochs, targetToken, usdcWethFee, wethTargetFee, slippageBps)`:
  - Builds path on-chain: `abi.encodePacked(USDC, usdcWethFee, WETH, wethTargetFee, targetToken)`
  - Edge case: if `targetToken == WETH`, builds single-hop `abi.encodePacked(USDC, usdcWethFee, WETH)`.
  - Validates fee params fit uint24; path validation reuses existing `_firstToken`/`_lastToken` helpers.
  - Calls `_createPositionFromPath` (same flow as `createPosition`).
- `createPosition` (unchanged API) — now delegates body to `_createPositionFromPath`.

### ABI: `packages/nextjs/contracts/deployedContracts.ts`
- Add `createPositionViaWETH` ABI entry manually (no redeploy in scope; customer confirms before complete).

### Frontend: `packages/nextjs/app/page.tsx`
- Add "Route via WETH (recommended)" toggle, default ON.
- When ON: show two fee tier dropdowns (USDC→WETH default 500bps, WETH→target default 3000bps); hide manual hop builder.
- When OFF: existing manual path builder unchanged.
- Call `createPositionViaWETH` when toggle ON, `createPosition` when toggle OFF.
- Update path preview to reflect auto-route.

### Tests: `packages/foundry/test/CLAWDdcaV3.t.sol`
- Add fork tests for `createPositionViaWETH` (two-hop path and WETH target edge case).

## Notes
- Customer asked: "Please do not complete the job until I give confirmation."
- After push + BGIPFS deploy, post preview URL + PR summary and wait for their OK before calling complete.sh.
- No contract redeployment coordinated here — customer reviews first; they control deployment timing.
