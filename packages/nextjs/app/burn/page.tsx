"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { ClientOnly } from "~~/components/ClientOnly";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const BurnInner = () => {
  const { data: burnBalance, refetch } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "burnFeeBalance",
  });

  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "CLAWDdcaV3" });
  const [busy, setBusy] = useState(false);

  const handleBurn = async () => {
    try {
      setBusy(true);
      await writeContractAsync({
        functionName: "executeBurn",
      });
      notification.success("Burn executed — CLAWD burned!");
      refetch();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Burn failed");
    } finally {
      setBusy(false);
    }
  };

  const balanceFormatted = burnBalance !== undefined ? formatUnits(burnBalance as bigint, 6) : "—";

  return (
    <div className="flex flex-col items-center grow pt-10 pb-16 px-4">
      <div className="max-w-2xl w-full">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold">Burn Dashboard</h1>
          <p className="text-base-content/70">Permissionless — swap accumulated USDC into CLAWD and burn it.</p>
        </div>

        <div className="card bg-base-100 shadow-xl">
          <div className="card-body items-center text-center">
            <div className="text-base-content/60 text-sm uppercase tracking-wide">Burn fee balance</div>
            <div className="text-5xl font-mono font-bold my-2">{balanceFormatted}</div>
            <div className="text-base-content/60">USDC ready to burn</div>

            <p className="my-4 text-sm text-base-content/70 max-w-md">
              Anyone can call <code className="bg-base-200 px-1 rounded">executeBurn</code>. The accumulated USDC is
              swapped to CLAWD via the configured burn path and the resulting CLAWD is sent to the burn address.
            </p>

            <button
              className="btn btn-error btn-lg"
              disabled={busy || (burnBalance as bigint | undefined) === 0n}
              onClick={handleBurn}
            >
              {busy ? "Burning…" : "Execute Burn"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const BurnPage: NextPage = () => (
  <ClientOnly>
    <BurnInner />
  </ClientOnly>
);

export default BurnPage;
