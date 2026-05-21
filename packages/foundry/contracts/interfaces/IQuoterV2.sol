// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Uniswap V3 QuoterV2 (subset)
/// @notice Note: quoteExactInput is NOT a view — it relies on revert/state-rewind. Use with staticcall/try-catch.
interface IQuoterV2 {
    function quoteExactInput(
        bytes memory path,
        uint256 amountIn
    )
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}
