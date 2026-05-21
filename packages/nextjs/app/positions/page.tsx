"use client";

import { useMemo } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useReadContracts } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import { PositionCard, type PositionData } from "~~/components/PositionCard";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const PositionsInner = () => {
  const { address: connectedAddress, isConnected } = useAccount();

  const { data: positionIds, refetch: refetchIds } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "getPositionsByOwner",
    args: [connectedAddress],
  });

  const { data: currentEpoch } = useScaffoldReadContract({
    contractName: "CLAWDdcaV3",
    functionName: "currentEpoch",
  });

  const dcaAbi = deployedContracts[8453].CLAWDdcaV3.abi;
  const dcaAddress = deployedContracts[8453].CLAWDdcaV3.address;

  const ids = useMemo(() => (positionIds ? (positionIds as readonly bigint[]) : []), [positionIds]);

  const { data: positionsRaw, refetch: refetchPositions } = useReadContracts({
    contracts: ids.map(id => ({
      address: dcaAddress as `0x${string}`,
      abi: dcaAbi,
      functionName: "getPosition",
      args: [id],
    })),
    query: { enabled: ids.length > 0 },
  });

  const onMutated = () => {
    refetchIds();
    refetchPositions();
  };

  const activePositions = useMemo(() => {
    if (!positionsRaw) return [] as { id: bigint; data: PositionData }[];
    return ids
      .map((id, i) => ({
        id,
        data: positionsRaw[i]?.result as PositionData | undefined,
      }))
      .filter((entry): entry is { id: bigint; data: PositionData } => !!entry.data && entry.data.active);
  }, [ids, positionsRaw]);

  return (
    <div className="flex flex-col items-center grow pt-10 pb-16 px-4">
      <div className="max-w-4xl w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">My Positions</h1>
          <p className="text-base-content/70">Manage your DCA positions on Base.</p>
        </div>

        {!isConnected ? (
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center text-center">
              <p>Connect your wallet to view your positions.</p>
            </div>
          </div>
        ) : ids.length === 0 ? (
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center text-center">
              <p>You have no positions yet.</p>
              <p className="text-sm text-base-content/60">Head to the home page to create one.</p>
            </div>
          </div>
        ) : activePositions.length === 0 ? (
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center text-center">
              <p>No active positions.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activePositions.map(({ id, data }) => (
              <PositionCard
                key={id.toString()}
                positionId={id}
                position={data}
                currentEpoch={currentEpoch as bigint | undefined}
                onMutated={onMutated}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const PositionsPage: NextPage = () => (
  <ClientOnly>
    <PositionsInner />
  </ClientOnly>
);

export default PositionsPage;
