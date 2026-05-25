import type { Address } from "viem";

export const CLAWD_DCA_ADDRESS = "0x096f3db3c7910061d798a2e2865844a24d13bf9c" as const;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;
export const EPOCH_DURATION_SECONDS = 10800n; // 3 hours

/**
 * Encode a Uniswap V3 multi-hop swap path.
 *
 * Layout: token0 (20 bytes) | fee01 (3 bytes) | token1 (20 bytes) | fee12 (3 bytes) | ... | tokenN (20 bytes)
 *
 * tokens.length must equal fees.length + 1.
 */
export function encodeV3Path(tokens: Address[], fees: number[]): `0x${string}` {
  if (tokens.length < 2) {
    throw new Error("encodeV3Path: need at least 2 tokens");
  }
  if (tokens.length !== fees.length + 1) {
    throw new Error("encodeV3Path: tokens.length must equal fees.length + 1");
  }
  let encoded = "";
  for (let i = 0; i < tokens.length; i++) {
    const addr = tokens[i].toLowerCase().replace(/^0x/, "");
    if (addr.length !== 40) {
      throw new Error(`encodeV3Path: invalid address ${tokens[i]}`);
    }
    encoded += addr;
    if (i < fees.length) {
      encoded += fees[i].toString(16).padStart(6, "0");
    }
  }
  return `0x${encoded}` as `0x${string}`;
}

export const FEE_TIERS = [
  { value: 100, label: "0.01%" },
  { value: 500, label: "0.05%" },
  { value: 3000, label: "0.3%" },
  { value: 10000, label: "1%" },
] as const;

export function feeLabel(fee: number): string {
  return `${(fee / 10000).toString()}%`;
}

export const INTERVAL_OPTIONS = [
  { value: 1, label: "3 hours (1 epoch)" },
  { value: 2, label: "6 hours (2 epochs)" },
  { value: 4, label: "12 hours (4 epochs)" },
  { value: 8, label: "24 hours (8 epochs)" },
  { value: 16, label: "48 hours (16 epochs)" },
] as const;
