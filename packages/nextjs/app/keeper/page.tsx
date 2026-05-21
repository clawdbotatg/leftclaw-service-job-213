"use client";

import { useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useReadContracts } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useScaffoldWriteContract, useWriteAndOpen } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

type Position = {
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

const KeeperInner = () => {
  const dcaAbi = deployedContracts[8453].CLAWDdcaV3.abi;
  const dcaAddress = deployedContracts[8453].CLAWDdcaV3.address as `0x${string}`;

  const { data: nextId } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "nextPositionId",
  });

  const { data: currentEpoch } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "currentEpoch",
  });

  const allIds = useMemo<bigint[]>(() => {
    if (nextId === undefined) return [];
    const n = nextId as bigint;
    const arr: bigint[] = [];
    for (let i = 0n; i < n; i++) arr.push(i);
    return arr;
  }, [nextId]);

  const { data: ripeData, refetch: refetchRipe } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "getRipePositions",
    args: [allIds],
  });

  const ripeIds = useMemo<bigint[]>(() => {
    if (!ripeData) return [];
    return [...(ripeData as readonly bigint[])];
  }, [ripeData]);

  const { data: ripePositionsRaw, refetch: refetchRipePositions } = useReadContracts({
    contracts: ripeIds.map(id => ({
      address: dcaAddress,
      abi: dcaAbi,
      functionName: "getPosition",
      args: [id],
    })),
    query: { enabled: ripeIds.length > 0 },
  });

  const ripePositions = useMemo(() => {
    if (!ripePositionsRaw) return [] as { id: bigint; data: Position }[];
    return ripeIds
      .map((id, i) => ({ id, data: ripePositionsRaw[i]?.result as Position | undefined }))
      .filter((entry): entry is { id: bigint; data: Position } => !!entry.data);
  }, [ripeIds, ripePositionsRaw]);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "CLAWDdcaV3" });
  const { writeAndOpen } = useWriteAndOpen();
  const [executingId, setExecutingId] = useState<bigint | null>(null);
  const [batchExecuting, setBatchExecuting] = useState(false);

  const handleExecute = async (id: bigint) => {
    try {
      setExecutingId(id);
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "executeDCA",
          args: [id],
        }),
      );
      notification.success(`Executed position #${id.toString()}`);
      refetchRipe();
      refetchRipePositions();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Execute failed");
    } finally {
      setExecutingId(null);
    }
  };

  const handleBatch = async () => {
    if (ripeIds.length === 0) return;
    try {
      setBatchExecuting(true);
      await writeAndOpen(() =>
        writeContractAsync({
          functionName: "executeBatch",
          args: [ripeIds],
        }),
      );
      notification.success(`Executed ${ripeIds.length} positions`);
      refetchRipe();
      refetchRipePositions();
    } catch (err: any) {
      notification.error(err?.shortMessage || err?.message || "Batch execute failed");
    } finally {
      setBatchExecuting(false);
    }
  };

  return (
    <div className="flex flex-col items-center grow pt-10 pb-16 px-4">
      <div className="max-w-4xl w-full">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Keeper Dashboard</h1>
            <p className="text-base-content/70">Execute ripe DCA positions and earn keeper fees.</p>
          </div>
          <div className="flex flex-col items-end text-sm">
            <span>
              Total ripe: <span className="font-mono font-bold">{ripeIds.length}</span>
            </span>
            <span>
              Current epoch:{" "}
              <span className="font-mono">
                {currentEpoch !== undefined ? (currentEpoch as bigint).toString() : "—"}
              </span>
            </span>
          </div>
        </div>

        <div className="mb-4">
          <button
            className="btn btn-primary"
            disabled={ripeIds.length === 0 || batchExecuting || isMining}
            onClick={handleBatch}
          >
            {batchExecuting ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              `Batch Execute (${ripeIds.length})`
            )}
          </button>
        </div>

        {ripePositions.length === 0 ? (
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center text-center">
              <p>No ripe positions right now.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {ripePositions.map(({ id, data }) => {
              const keeperFee = (data.amountPerSwap * 10n) / 10000n;
              return (
                <div key={id.toString()} className="card bg-base-100 shadow-md">
                  <div className="card-body py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold">Position #{id.toString()}</span>
                        <Address address={data.targetToken} />
                      </div>
                      <div className="text-sm">
                        <div>
                          USDC balance: <span className="font-mono">{formatUnits(data.usdcBalance, 6)}</span>
                        </div>
                        <div>
                          Est. keeper fee: <span className="font-mono">{formatUnits(keeperFee, 6)} USDC</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={executingId === id || isMining}
                        onClick={() => handleExecute(id)}
                      >
                        {executingId === id ? <span className="loading loading-spinner loading-sm" /> : "Execute"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const KeeperPage: NextPage = () => (
  <ClientOnly>
    <KeeperInner />
  </ClientOnly>
);

export default KeeperPage;
