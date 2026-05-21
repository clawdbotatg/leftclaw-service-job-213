// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Uniswap V3 SwapRouter02 (subset) for multi-hop swaps via encoded path.
interface ISwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Swaps `amountIn` of one token for as much as possible of another along the specified path.
    /// @dev SwapRouter02 omits the `deadline` field from V1 — confirm Base address (0x2626664c...) is SwapRouter02.
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
