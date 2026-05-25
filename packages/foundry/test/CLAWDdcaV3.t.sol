// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { CLAWDdcaV3 } from "../contracts/CLAWDdcaV3.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Fork tests against Base mainnet. Run with:
///      forge test --fork-url $ALCHEMY_BASE_URL -vvv
contract CLAWDdcaV3Test is Test {
    CLAWDdcaV3 dca;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;

    address owner = makeAddr("owner");
    address user = makeAddr("user");

    uint256 constant ONE_USDC = 1e6;
    uint256 constant TEN_USDC = 10e6;

    function setUp() public {
        bytes memory burnPath = abi.encodePacked(USDC, uint24(500), WETH, uint24(10000), CLAWD);
        dca = new CLAWDdcaV3(owner, burnPath);

        // Fund user with USDC (Base mainnet whale: Coinbase custody)
        deal(USDC, user, 1000e6);
        vm.prank(user);
        IERC20(USDC).approve(address(dca), type(uint256).max);
    }

    // ── createPositionViaWETH: two-hop path (USDC → WETH → targetToken) ────────

    function test_createPositionViaWETH_twoHop() public {
        vm.prank(user);
        uint256 posId = dca.createPositionViaWETH(
            TEN_USDC,   // totalUSDC
            ONE_USDC,   // amountPerSwap
            1,          // intervalInEpochs
            CLAWD,      // targetToken (USDC → WETH → CLAWD)
            500,        // usdcWethFee (0.05%)
            10000,      // wethTargetFee (1%)
            300         // slippageBps
        );

        CLAWDdcaV3.Position memory p = dca.getPosition(posId);
        assertEq(p.owner, user);
        assertEq(p.targetToken, CLAWD);
        assertEq(p.usdcBalance, TEN_USDC);
        assertEq(p.amountPerSwap, ONE_USDC);
        assertTrue(p.active);

        // Path must be USDC → 500 → WETH → 10000 → CLAWD (66 bytes)
        assertEq(p.swapPath.length, 66);
        // First token in path = USDC
        address firstTok;
        bytes memory path = p.swapPath;
        assembly { firstTok := shr(96, mload(add(path, 32))) }
        assertEq(firstTok, USDC);
        // Last token in path = CLAWD
        address lastTok;
        uint256 len = path.length;
        assembly { lastTok := shr(96, mload(add(add(path, 32), sub(len, 20)))) }
        assertEq(lastTok, CLAWD);
    }

    // ── createPositionViaWETH: single-hop path when targetToken == WETH ─────────

    function test_createPositionViaWETH_targetIsWETH() public {
        vm.prank(user);
        uint256 posId = dca.createPositionViaWETH(
            TEN_USDC,
            ONE_USDC,
            1,
            WETH,   // targetToken == WETH → single hop USDC → WETH
            500,    // usdcWethFee
            3000,   // wethTargetFee (ignored)
            300
        );

        CLAWDdcaV3.Position memory p = dca.getPosition(posId);
        assertEq(p.targetToken, WETH);
        // Single-hop path: 20 + 3 + 20 = 43 bytes
        assertEq(p.swapPath.length, 43);
    }

    // ── createPositionViaWETH: reverts on USDC as targetToken ───────────────────

    function test_createPositionViaWETH_rejectsUSDC() public {
        vm.prank(user);
        vm.expectRevert(CLAWDdcaV3.InvalidTargetToken.selector);
        dca.createPositionViaWETH(TEN_USDC, ONE_USDC, 1, USDC, 500, 3000, 300);
    }

    // ── createPositionViaWETH: reverts on zero address ──────────────────────────

    function test_createPositionViaWETH_rejectsZeroAddress() public {
        vm.prank(user);
        vm.expectRevert(CLAWDdcaV3.InvalidTargetToken.selector);
        dca.createPositionViaWETH(TEN_USDC, ONE_USDC, 1, address(0), 500, 3000, 300);
    }

    // ── createPosition still works (regression) ─────────────────────────────────

    function test_createPosition_directPath() public {
        bytes memory path = abi.encodePacked(USDC, uint24(500), WETH);
        vm.prank(user);
        uint256 posId = dca.createPosition(TEN_USDC, ONE_USDC, 1, WETH, path, 300);

        CLAWDdcaV3.Position memory p = dca.getPosition(posId);
        assertEq(p.targetToken, WETH);
        assertTrue(p.active);
    }
}
