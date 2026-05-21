// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { CLAWDdcaV3 } from "../contracts/CLAWDdcaV3.sol";

/**
 * @notice Deploy CLAWDdcaV3 to Base mainnet.
 * @dev Reads PRIVATE_KEY from env (via the standard scaffold broadcast flow). Sets the contract
 *      owner to the client-supplied address. Pre-seeds the burn path as
 *      USDC --(500 fee)--> WETH --(10000 fee)--> CLAWD.
 *
 * Usage:
 *   PRIVATE_KEY=0x... forge script script/DeployCLAWDdcaV3.s.sol --rpc-url base --broadcast --verify
 *   (or via scaffold-eth `yarn deploy --file DeployCLAWDdcaV3.s.sol --network base`)
 */
contract DeployCLAWDdcaV3 is ScaffoldETHDeploy {
    // Client-supplied owner.
    address internal constant CLIENT_OWNER = 0x8d6FB6C5f77155FEF58629325ad62E295329e22D;

    // Hardcoded token + fee constants for the initial burn path.
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;

    function run() external ScaffoldEthDeployerRunner returns (CLAWDdcaV3 deployed) {
        bytes memory initialBurnSwapPath = abi.encodePacked(
            USDC,
            uint24(500),
            WETH,
            uint24(10000),
            CLAWD
        );

        deployed = new CLAWDdcaV3(CLIENT_OWNER, initialBurnSwapPath);

        deployments.push(Deployment({ name: "CLAWDdcaV3", addr: address(deployed) }));
    }
}
