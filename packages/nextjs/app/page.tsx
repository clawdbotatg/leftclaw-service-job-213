"use client";

import { useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Address, AddressInput } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { type Address as AddressType, formatUnits, isAddress, parseUnits } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import {
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
  useWriteAndOpen,
} from "~~/hooks/scaffold-eth";
import { CLAWD_DCA_ADDRESS, FEE_TIERS, INTERVAL_OPTIONS, WETH_ADDRESS, feeLabel } from "~~/utils/clawd";
import { notification } from "~~/utils/scaffold-eth";

const HomeInner = () => {
  const { address: connectedAddress, isConnected } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const { writeAndOpen } = useWriteAndOpen();

  const [targetToken, setTargetToken] = useState<string>("");
  const [usdcWethFee, setUsdcWethFee] = useState<number>(500);
  const [wethTargetFee, setWethTargetFee] = useState<number>(3000);

  const [amountPerSwap, setAmountPerSwap] = useState<string>("1");
  const [totalUsdc, setTotalUsdc] = useState<string>("10");
  const [intervalEpochs, setIntervalEpochs] = useState<number>(8);
  const [slippagePct, setSlippagePct] = useState<string>("3");

  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalCooldown, setApprovalCooldown] = useState(false);

  // Read USDC balance & allowance
  const { data: usdcBalance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  const { data: usdcAllowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "allowance",
    args: [connectedAddress, CLAWD_DCA_ADDRESS],
  });

  const { data: currentEpoch } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "currentEpoch",
  });

  const { writeContractAsync: approveUsdc } = useScaffoldWriteContract({ contractName: "USDC" });
  const { writeContractAsync: writeDca, isMining } = useScaffoldWriteContract({ contractName: "CLAWDdcaV3" });

  // ---- Derived values ----
  const totalUsdcWei = useMemo(() => {
    try {
      if (!totalUsdc) return 0n;
      return parseUnits(totalUsdc, 6);
    } catch {
      return 0n;
    }
  }, [totalUsdc]);

  const amountPerSwapWei = useMemo(() => {
    try {
      if (!amountPerSwap) return 0n;
      return parseUnits(amountPerSwap, 6);
    } catch {
      return 0n;
    }
  }, [amountPerSwap]);

  const slippageBps = useMemo(() => {
    const n = parseFloat(slippagePct || "0");
    if (Number.isNaN(n)) return 0;
    return Math.floor(n * 100);
  }, [slippagePct]);

  // Build path preview — always via WETH
  const pathPreview = useMemo(() => {
    const targetLabel = targetToken ? `${targetToken.slice(0, 6)}…${targetToken.slice(-4)}` : "TARGET";
    if (isAddress(targetToken) && targetToken.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
      return `USDC → ${feeLabel(usdcWethFee)} → WETH`;
    }
    return `USDC → ${feeLabel(usdcWethFee)} → WETH → ${feeLabel(wethTargetFee)} → ${targetLabel}`;
  }, [usdcWethFee, wethTargetFee, targetToken]);

  // ---- Validation ----
  const formErrors = useMemo<string[]>(() => {
    const errors: string[] = [];
    if (!isAddress(targetToken)) errors.push("Enter a valid target token address.");
    if (amountPerSwapWei < 1_000_000n) errors.push("Amount per swap must be >= 1 USDC.");
    if (totalUsdcWei < amountPerSwapWei) errors.push("Total USDC must be >= amount per swap.");
    if (slippageBps <= 0 || slippageBps > 1000) errors.push("Slippage must be > 0% and <= 10%.");
    if (isAddress(targetToken) && targetToken.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") {
      errors.push("Target token cannot be USDC.");
    }
    return errors;
  }, [targetToken, amountPerSwapWei, totalUsdcWei, slippageBps]);

  // ---- Approval / wallet flow ----
  const isWrongNetwork = isConnected && targetNetwork.id !== base.id;
  const needsApproval = totalUsdcWei > 0n && (usdcAllowance ?? 0n) < totalUsdcWei;

  const handleApprove = async () => {
    if (approvalSubmitting || approvalCooldown) return;
    try {
      setApprovalSubmitting(true);
      await writeAndOpen(() =>
        approveUsdc({
          functionName: "approve",
          args: [CLAWD_DCA_ADDRESS, totalUsdcWei],
        }),
      );
      notification.success("USDC approved");
      setApprovalCooldown(true);
      setTimeout(() => setApprovalCooldown(false), 4000);
      await refetchAllowance();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Approval failed");
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (formErrors.length > 0) {
      notification.error(formErrors[0] || "Invalid form");
      return;
    }
    try {
      const txHash = await writeAndOpen(() =>
        writeDca({
          functionName: "createPositionViaWETH",
          args: [
            totalUsdcWei,
            amountPerSwapWei,
            BigInt(intervalEpochs),
            targetToken as AddressType,
            usdcWethFee,
            wethTargetFee,
            BigInt(slippageBps),
          ],
        }),
      );
      if (txHash) {
        notification.success("Position created! Check /positions for details.");
      }
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Create failed");
    }
  };

  return (
    <div className="flex flex-col items-center grow pt-10 pb-16 px-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">CLAWD DCA V3</h1>
          <p className="text-base-content/70">Permissionless DCA engine on Base. Auto-swap USDC into any Base token.</p>
          <p className="text-sm text-base-content/50 mt-1">
            Contract: <Address address="0xdb5da5b9c55d5fc72eb19692ab41aabbc46278ac" />
          </p>
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Create Position</h2>

            {/* Target Token */}
            <label className="form-control w-full">
              <span className="label-text font-semibold">Target Token</span>
              <AddressInput value={targetToken} onChange={setTargetToken} placeholder="0x... target token address" />
            </label>

            {/* Swap Path — always via WETH */}
            <div className="form-control w-full mt-4">
              <span className="label-text font-semibold">Swap Path</span>
              <div className="bg-base-200 p-3 rounded-lg space-y-3 mt-1">
                <div className="text-sm font-mono break-all">{pathPreview}</div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <label className="form-control flex-1">
                    <span className="label-text text-xs">USDC → WETH fee tier</span>
                    <select
                      className="select select-bordered select-sm"
                      value={usdcWethFee}
                      onChange={e => setUsdcWethFee(parseInt(e.target.value, 10))}
                    >
                      {FEE_TIERS.map(f => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(!isAddress(targetToken) || targetToken.toLowerCase() !== WETH_ADDRESS.toLowerCase()) && (
                    <label className="form-control flex-1">
                      <span className="label-text text-xs">WETH → Target fee tier</span>
                      <select
                        className="select select-bordered select-sm"
                        value={wethTargetFee}
                        onChange={e => setWethTargetFee(parseInt(e.target.value, 10))}
                      >
                        {FEE_TIERS.map(f => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </div>

            {/* Amounts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              <label className="form-control">
                <span className="label-text font-semibold">Amount Per Swap (USDC)</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  className="input input-bordered"
                  value={amountPerSwap}
                  onChange={e => setAmountPerSwap(e.target.value)}
                />
              </label>
              <label className="form-control">
                <span className="label-text font-semibold">Total USDC</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  className="input input-bordered"
                  value={totalUsdc}
                  onChange={e => setTotalUsdc(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label className="form-control">
                <span className="label-text font-semibold">Interval</span>
                <select
                  className="select select-bordered"
                  value={intervalEpochs}
                  onChange={e => setIntervalEpochs(parseInt(e.target.value, 10))}
                >
                  {INTERVAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text font-semibold">Slippage (%)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10"
                  className="input input-bordered"
                  value={slippagePct}
                  onChange={e => setSlippagePct(e.target.value)}
                />
              </label>
            </div>

            {/* Status row */}
            <div className="flex flex-wrap gap-4 text-sm mt-4 text-base-content/70">
              <span>
                USDC balance:{" "}
                <span className="font-mono">
                  {usdcBalance !== undefined ? formatUnits(usdcBalance as bigint, 6) : "—"}
                </span>
              </span>
              <span>
                Current epoch:{" "}
                <span className="font-mono">
                  {currentEpoch !== undefined ? (currentEpoch as bigint).toString() : "—"}
                </span>
              </span>
            </div>

            {/* Errors */}
            {formErrors.length > 0 && (
              <ul className="mt-3 text-error text-sm list-disc list-inside">
                {formErrors.map(e => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            {/* Action button (4-state wallet flow) */}
            <div className="card-actions justify-end mt-4">
              {!isConnected ? (
                <button className="btn btn-primary" onClick={() => openConnectModal?.()}>
                  Connect Wallet
                </button>
              ) : isWrongNetwork ? (
                <button className="btn btn-warning" onClick={() => switchChain({ chainId: base.id })}>
                  Switch to Base
                </button>
              ) : needsApproval ? (
                <button
                  className="btn btn-primary"
                  disabled={approvalSubmitting || approvalCooldown || totalUsdcWei === 0n}
                  onClick={handleApprove}
                >
                  {approvalSubmitting || approvalCooldown ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    `Approve ${totalUsdc || "0"} USDC`
                  )}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={isMining || formErrors.length > 0} onClick={handleCreate}>
                  {isMining ? <span className="loading loading-spinner loading-sm" /> : "Create Position"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Home: NextPage = () => (
  <ClientOnly>
    <HomeInner />
  </ClientOnly>
);

export default Home;
