# Feature Job #225 — Auto-routing via WETH (always on)

## Request
"We want our DCA contract to have auto-routing via WETH built into every swap automatically, not a manual thing the user has to add."

## Previous agent work (already complete)
- Contract: `createPositionViaWETH` added; `createPosition` still exists as advanced entrypoint.
- Frontend: WETH routing toggle defaulted ON, with manual path builder as an off-state.
- Tests: Fork tests for `createPositionViaWETH` added.

## This session's scope — remove the toggle
Client follow-up: they don't want a toggle — WETH routing should be the ONLY option in the UI.

### Frontend: `packages/nextjs/app/page.tsx`
- Remove `routeViaWeth` state, always treat as true.
- Remove `hops`, `finalFee`, `addHop`, `removeHop`, `updateHop` state/helpers.
- Remove `encodedSwapPath` useMemo.
- Remove `Hop` type.
- Simplify `pathPreview` to always show WETH route.
- Simplify `formErrors` — no manual path validation.
- Simplify `handleCreate` — always calls `createPositionViaWETH`.
- Remove toggle checkbox and manual hop builder JSX.

### Contract + tests — no changes needed.

## Notes
- Customer: do NOT call complete.sh until they confirm.
- After build + BGIPFS ship + push: post the preview URL and wait for OK.
