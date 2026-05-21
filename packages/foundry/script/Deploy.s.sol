//SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { DeployCLAWDdcaV3 } from "./DeployCLAWDdcaV3.s.sol";

/**
 * @notice Main deployment script for all contracts
 * @dev Run this when you want to deploy multiple contracts at once
 *
 * Example: yarn deploy # runs this script(without`--file` flag)
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        DeployCLAWDdcaV3 deployDca = new DeployCLAWDdcaV3();
        deployDca.run();
    }
}
