"use client";

import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { erc20Abi, formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract, useWriteAndOpen } from "~~/hooks/scaffold-eth";
import { EPOCH_DURATION_SECONDS } from "~~/utils/clawd";
import { notification } from "~~/utils/scaffold-eth";

export type PositionData = {
  owner: `0x${string}`;
  targetToken: `0x${string}`;
  swapPath: `0x${string}`;
  usdcBalance: bigint;
  tokenAccrued: bigint;
  amountPerSwap: bigint;
  intervalInEpochs: bigint;
  lastExecutedEpoch: bigint;
  slippageBps: bigint;
  active: boolean;
};

type Props = {
  positionId: bigint;
  position: PositionData;
  currentEpoch?: bigint;
  onMutated?: () => void;
};

export const PositionCard = ({ positionId, position, currentEpoch, onMutated }: Props) => {
  const [busy, setBusy] = useState<"withdraw" | "close" | null>(null);

  const { data: tokenMeta } = useReadContracts({
    contracts: [
      { address: position.targetToken, abi: erc20Abi, functionName: "symbol" },
      { address: position.targetToken, abi: erc20Abi, functionName: "decimals" },
    ],
    query: { enabled: !!position.targetToken },
  });
  const tokenSymbol = (tokenMeta?.[0]?.result as string | undefined) ?? "TOKEN";
  const tokenDecimals = (tokenMeta?.[1]?.result as number | undefined) ?? 18;

  const { data: ripe } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "isRipe",
    args: [positionId],
  });

  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "CLAWDdcaV3" });
  const { writeAndOpen } = useWriteAndOpen();

  const handleWithdraw = async () => {
    if (busy) return;
    try {
      setBusy("withdraw");
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "withdrawToken",
          args: [positionId],
        }),
      );
      notification.success(`Withdrew accrued ${tokenSymbol}`);
      onMutated?.();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Withdraw failed");
    } finally {
      setBusy(null);
    }
  };

  const handleClose = async () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Close this position and refund remaining USDC?")) return;
    try {
      setBusy("close");
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "closePosition",
          args: [positionId],
        }),
      );
      notification.success(`Position #${positionId.toString()} closed`);
      onMutated?.();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Close failed");
    } finally {
      setBusy(null);
    }
  };

  // Next execution: lastExecutedEpoch + intervalInEpochs
  const nextEpoch = position.lastExecutedEpoch + position.intervalInEpochs;
  const epochsUntilNext = currentEpoch !== undefined && currentEpoch < nextEpoch ? nextEpoch - currentEpoch : 0n;
  const secondsUntilNext = epochsUntilNext * EPOCH_DURATION_SECONDS;

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <h3 className="card-title">
            Position #{positionId.toString()}
            {position.active ? (
              <span className="badge badge-success badge-sm ml-2">Active</span>
            ) : (
              <span className="badge badge-ghost badge-sm ml-2">Inactive</span>
            )}
            {ripe ? <span className="badge badge-warning badge-sm ml-1">Ripe</span> : null}
          </h3>
          <div className="text-sm">
            <Address address={position.targetToken} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 text-sm">
          <div>
            <div className="text-base-content/60">USDC balance</div>
            <div className="font-mono">{formatUnits(position.usdcBalance, 6)} USDC</div>
          </div>
          <div>
            <div className="text-base-content/60">{tokenSymbol} accrued</div>
            <div className="font-mono">
              {formatUnits(position.tokenAccrued, tokenDecimals)} {tokenSymbol}
            </div>
          </div>
          <div>
            <div className="text-base-content/60">Amount per swap</div>
            <div className="font-mono">{formatUnits(position.amountPerSwap, 6)} USDC</div>
          </div>
          <div>
            <div className="text-base-content/60">Interval</div>
            <div className="font-mono">
              {position.intervalInEpochs.toString()} epochs ({(position.intervalInEpochs * 3n).toString()}h)
            </div>
          </div>
          <div>
            <div className="text-base-content/60">Slippage</div>
            <div className="font-mono">{(Number(position.slippageBps) / 100).toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-base-content/60">Next execution</div>
            <div className="font-mono">
              {ripe
                ? "Ready now"
                : epochsUntilNext === 0n
                  ? "—"
                  : `~${epochsUntilNext.toString()} epoch(s) / ~${(Number(secondsUntilNext) / 3600).toFixed(1)}h`}
            </div>
          </div>
        </div>

        <div className="card-actions justify-end mt-3">
          <button
            className="btn btn-sm btn-secondary"
            disabled={position.tokenAccrued === 0n || busy === "withdraw"}
            onClick={handleWithdraw}
          >
            {busy === "withdraw" ? <span className="loading loading-spinner loading-sm" /> : "Withdraw"}
          </button>
          <button
            className="btn btn-sm btn-error"
            disabled={busy === "close" || !position.active}
            onClick={handleClose}
          >
            {busy === "close" ? <span className="loading loading-spinner loading-sm" /> : "Close Position"}
          </button>
        </div>
      </div>
    </div>
  );
};
