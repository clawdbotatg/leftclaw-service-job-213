# Feature Job #224 — Fix "Swap path could not be encoded"

## Root cause

`page.tsx` initialises `hops` state as `[{ token: "", fee: 3000 }]` — one empty
intermediate hop. The `encodedSwapPath` memo returns `null` if any hop token is
not a valid address. The Remove button is `disabled={hops.length === 1}`, so the
user can never reduce to zero hops.

Most positions are direct USDC → targetToken swaps with no intermediary, so the
path fails to encode every time a new user opens the form.

## Fix (minimal, two lines changed)

1. `packages/nextjs/app/page.tsx` line 33:
   Change initial state from `[{ token: "", fee: 3000 }]` → `[]`

2. `packages/nextjs/app/page.tsx` line ~248:
   Remove `disabled={hops.length === 1}` so users can remove all intermediate
   hops (going back to 0 is now valid).

## Why this works

When `hops = []`:
- `encodedSwapPath` loop never runs → `tokens = [USDC, targetToken]`, `fees = [finalFee]`
- `encodeV3Path([USDC, target], [finalFee])` → valid 43-byte path
- Contract path-length check: `43 >= 43 && (43-20) % 23 == 0` ✓
- `pathPreview` renders `USDC → 0.3% → TARGET` correctly (loop over empty array)

No changes to `encodeV3Path`, `encodedSwapPath`, or contract interaction code needed.

## Scope

Only `packages/nextjs/app/page.tsx`. Build + typecheck + redeploy to BGIPFS.
