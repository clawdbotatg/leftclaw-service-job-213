// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ISwapRouter } from "./interfaces/ISwapRouter.sol";
import { IQuoterV2 } from "./interfaces/IQuoterV2.sol";

/**
 * @title CLAWDdcaV3 — A Generalized DCA Engine on Base
 * @notice Permissionless dollar-cost-averaging engine. Users deposit USDC and pre-configure a
 *         swap path / interval. Anyone can call `executeDCA` once a position is "ripe" and
 *         earn a small keeper fee. A portion of every swap is sweeped into CLAWD and burned.
 *
 *         Architecture notes:
 *         - Schedule is epoch-based (3-hour buckets) to make off-chain keeper coordination cheap.
 *         - Swap path is a raw Uniswap V3 multihop path (token,fee,token,fee,token,...). Storing
 *           the path means we never trust path data at execute time and avoids ABI overhead.
 *         - Keeper / protocol / burn fees are flat 10 bps each (30 bps total). Hardcoded for
 *           predictability — if these need to be tunable, ship a v4 rather than a setter.
 *         - QuoterV2 is consulted via try/catch; if it fails (e.g. router state, OOG) we fall
 *           back to amountOutMinimum = 1 so the position is not stuck. Callers wanting tighter
 *           protection should use `executeDCAWithMin`.
 *
 *         Inherits Ownable2Step for safe ownership handoff (matches client request).
 */
contract CLAWDdcaV3 is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Hardcoded Base mainnet addresses
    // ─────────────────────────────────────────────────────────────────────────

    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant SWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant QUOTER = 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant EPOCH_DURATION = 3 hours;
    uint256 public constant KEEPER_FEE_BPS = 10;
    uint256 public constant PROTOCOL_FEE_BPS = 10;
    uint256 public constant BURN_FEE_BPS = 10;
    uint256 public constant DEFAULT_SLIPPAGE_BPS = 300;
    uint256 public constant MAX_SLIPPAGE_BPS = 1000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────

    struct Position {
        address owner;
        address targetToken;
        bytes swapPath;
        uint256 usdcBalance;
        uint256 tokenAccrued;
        uint256 amountPerSwap;
        uint256 intervalInEpochs;
        uint256 lastExecutedEpoch;
        uint256 slippageBps;
        bool active;
    }

    mapping(uint256 => Position) public positions;
    mapping(address => uint256[]) public positionsByOwner;
    uint256 public nextPositionId;
    uint256 public protocolFeeBalance;
    uint256 public burnFeeBalance;
    bytes public burnSwapPath;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    event PositionCreated(
        uint256 indexed positionId,
        address indexed owner,
        address indexed targetToken,
        uint256 totalUSDC,
        uint256 amountPerSwap,
        uint256 intervalInEpochs,
        uint256 slippageBps
    );

    event PositionExecuted(
        uint256 indexed positionId,
        address indexed keeper,
        uint256 amountSwapped,
        uint256 tokenReceived,
        uint256 keeperFee,
        uint256 epoch
    );

    event PositionClosed(uint256 indexed positionId, address indexed closedBy, uint256 usdcRefunded, uint256 tokenRefunded);
    event TokenWithdrawn(uint256 indexed positionId, address indexed owner, uint256 amount);
    event BurnExecuted(uint256 indexed executor, uint256 usdcIn, uint256 clawdBurned);
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);
    event BurnSwapPathUpdated(bytes newPath);

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────

    error InvalidAmount();
    error InvalidInterval();
    error InvalidPath();
    error InvalidSlippage();
    error PathTokenMismatch();
    error NotPositionOwner();
    error NotOwnerOrPositionOwner();
    error PositionInactive();
    error PositionNotRipe();
    error InsufficientBalance();
    error NothingToWithdraw();
    error NothingToBurn();
    error BurnPathNotSet();
    error EmptyBatch();

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param initialOwner Owner that can pause, withdraw protocol fees, set burn path, etc.
     * @param initialBurnSwapPath Encoded Uniswap V3 path from USDC → … → CLAWD used by `executeBurn`.
     *        Validated to end in CLAWD. May be empty — `executeBurn` will revert until configured.
     */
    constructor(address initialOwner, bytes memory initialBurnSwapPath) Ownable(initialOwner) {
        if (initialBurnSwapPath.length > 0) {
            _validateBurnPath(initialBurnSwapPath);
            burnSwapPath = initialBurnSwapPath;
        }
        // Pre-approve the router to spend USDC. We always swap USDC → X, so a single max approval
        // is reasonable here. forceApprove handles tokens that revert on non-zero allowance change.
        IERC20(USDC).forceApprove(SWAP_ROUTER, type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Position lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Open a new DCA position.
     * @param totalUSDC Initial USDC to lock in the position. Pulled from msg.sender.
     * @param amountPerSwap USDC spent per execution (must be ≤ totalUSDC).
     * @param intervalInEpochs Number of 3-hour epochs between executions (≥ 1).
     * @param targetToken The token the user wants to accrue.
     * @param swapPath Uniswap V3 encoded path. Must start with USDC and end with targetToken.
     * @param slippageBps Per-swap slippage tolerance. 0 → DEFAULT_SLIPPAGE_BPS; capped at MAX_SLIPPAGE_BPS.
     */
    function createPosition(
        uint256 totalUSDC,
        uint256 amountPerSwap,
        uint256 intervalInEpochs,
        address targetToken,
        bytes calldata swapPath,
        uint256 slippageBps
    ) external whenNotPaused nonReentrant returns (uint256 positionId) {
        if (amountPerSwap == 0 || totalUSDC < amountPerSwap) revert InvalidAmount();
        if (intervalInEpochs == 0) revert InvalidInterval();

        // Validate path layout: 20 (token) + N * (3 fee + 20 token), minimum 1 hop → 43 bytes.
        if (swapPath.length < 43 || (swapPath.length - 20) % 23 != 0) revert InvalidPath();
        if (_firstToken(swapPath) != USDC) revert PathTokenMismatch();
        if (_lastToken(swapPath) != targetToken) revert PathTokenMismatch();

        uint256 effectiveSlippage = slippageBps;
        if (effectiveSlippage == 0) effectiveSlippage = DEFAULT_SLIPPAGE_BPS;
        if (effectiveSlippage > MAX_SLIPPAGE_BPS) revert InvalidSlippage();

        positionId = nextPositionId++;

        // Seed `lastExecutedEpoch` so the position is immediately ripe (currentEpoch - interval).
        uint256 currentEp = currentEpoch();
        uint256 seedEpoch = currentEp >= intervalInEpochs ? currentEp - intervalInEpochs : 0;

        positions[positionId] = Position({
            owner: msg.sender,
            targetToken: targetToken,
            swapPath: swapPath,
            usdcBalance: totalUSDC,
            tokenAccrued: 0,
            amountPerSwap: amountPerSwap,
            intervalInEpochs: intervalInEpochs,
            lastExecutedEpoch: seedEpoch,
            slippageBps: effectiveSlippage,
            active: true
        });
        positionsByOwner[msg.sender].push(positionId);

        // CEI: pull funds last.
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), totalUSDC);

        emit PositionCreated(positionId, msg.sender, targetToken, totalUSDC, amountPerSwap, intervalInEpochs, effectiveSlippage);
    }

    /**
     * @notice Trigger a DCA swap for a position. Anyone can call this when the position is ripe.
     * @dev Uses QuoterV2 inside try/catch to compute a slippage-protected minOut. If the quote
     *      reverts we fall back to minOut=1 so the position is never frozen by an unrelated
     *      quoter issue. Callers seeking strict guarantees should use `executeDCAWithMin`.
     */
    function executeDCA(uint256 positionId) external nonReentrant returns (uint256 tokenReceived) {
        return _executeDCA(positionId, 0, false);
    }

    /**
     * @notice Trigger a DCA swap with a caller-supplied min-out. Useful when the caller has
     *         already computed a tight quote off-chain and wants on-chain protection.
     */
    function executeDCAWithMin(uint256 positionId, uint256 amountOutMinimum)
        external
        nonReentrant
        returns (uint256 tokenReceived)
    {
        return _executeDCA(positionId, amountOutMinimum, true);
    }

    /**
     * @notice Best-effort batch execution. Skips positions that aren't ripe / are paused / fail.
     * @return results Array of tokenReceived values (0 entries indicate a skip or failure).
     */
    function executeBatch(uint256[] calldata positionIds) external nonReentrant returns (uint256[] memory results) {
        uint256 len = positionIds.length;
        if (len == 0) revert EmptyBatch();
        results = new uint256[](len);

        // Note: we cannot easily call _executeDCA inside try/catch because it isn't an external
        // call. We instead inline the cheap pre-checks and call ourselves via this.executeDCA
        // through try/catch so a single bad position can't brick the batch.
        for (uint256 i = 0; i < len; i++) {
            uint256 positionId = positionIds[i];
            if (paused()) break; // honor pause mid-batch
            Position storage p = positions[positionId];
            if (!p.active) continue;
            if (!isRipe(positionId)) continue;
            if (p.usdcBalance < p.amountPerSwap) continue;

            try this.executeDCAFromBatch(positionId) returns (uint256 out) {
                results[i] = out;
            } catch {
                // swallow per-position failures
            }
        }
    }

    /**
     * @notice Internal-style entry point that only the contract may invoke (via try/catch in batch).
     *         Marked external to be try/catch-able, but gated to this contract.
     */
    function executeDCAFromBatch(uint256 positionId) external returns (uint256 tokenReceived) {
        require(msg.sender == address(this), "only self");
        return _executeDCA(positionId, 0, false);
    }

    /**
     * @notice Withdraw accrued target token to the position's owner.
     */
    function withdrawToken(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        uint256 amount = p.tokenAccrued;
        if (amount == 0) revert NothingToWithdraw();

        // CEI
        p.tokenAccrued = 0;
        IERC20(p.targetToken).safeTransfer(p.owner, amount);

        emit TokenWithdrawn(positionId, p.owner, amount);
    }

    /**
     * @notice Close a position and refund any remaining USDC + accrued token to the position owner.
     *         Callable by the position owner or the contract owner (e.g. emergency wind-down).
     */
    function closePosition(uint256 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (msg.sender != p.owner && msg.sender != owner()) revert NotOwnerOrPositionOwner();
        if (!p.active) revert PositionInactive();

        uint256 usdcRefund = p.usdcBalance;
        uint256 tokenRefund = p.tokenAccrued;
        address recipient = p.owner;
        address targetToken = p.targetToken;

        // CEI: zero everything before external calls.
        p.usdcBalance = 0;
        p.tokenAccrued = 0;
        p.active = false;

        if (usdcRefund > 0) IERC20(USDC).safeTransfer(recipient, usdcRefund);
        if (tokenRefund > 0) IERC20(targetToken).safeTransfer(recipient, tokenRefund);

        emit PositionClosed(positionId, msg.sender, usdcRefund, tokenRefund);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Burn + protocol fee management
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Permissionless burn: swaps accumulated `burnFeeBalance` USDC into CLAWD and sends
     *         the output to the burn address. Slippage is set to MAX_SLIPPAGE_BPS via QuoterV2 to
     *         tolerate low-liquidity CLAWD pools while still rejecting catastrophic prints.
     */
    function executeBurn() external whenNotPaused nonReentrant returns (uint256 clawdBurned) {
        uint256 amountIn = burnFeeBalance;
        if (amountIn == 0) revert NothingToBurn();
        bytes memory path = burnSwapPath;
        if (path.length == 0) revert BurnPathNotSet();

        // CEI: zero the balance before swapping.
        burnFeeBalance = 0;

        uint256 minOut = _quoteWithSlippage(path, amountIn, MAX_SLIPPAGE_BPS);

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: BURN_ADDRESS,
            amountIn: amountIn,
            amountOutMinimum: minOut
        });
        clawdBurned = ISwapRouter(SWAP_ROUTER).exactInput(params);

        emit BurnExecuted(uint256(uint160(msg.sender)), amountIn, clawdBurned);
    }

    /// @notice Owner withdraws accrued protocol fees.
    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolFeeBalance;
        if (amount == 0) revert NothingToWithdraw();
        protocolFeeBalance = 0;
        IERC20(USDC).safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    /// @notice Owner updates the USDC → CLAWD burn path. Must terminate in CLAWD.
    function setBurnSwapPath(bytes calldata newPath) external onlyOwner {
        _validateBurnPath(newPath);
        burnSwapPath = newPath;
        emit BurnSwapPathUpdated(newPath);
    }

    /// @notice Owner-only pause / unpause. Stops new positions and new executions.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function currentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }

    function isRipe(uint256 positionId) public view returns (bool) {
        Position storage p = positions[positionId];
        if (!p.active) return false;
        if (p.usdcBalance < p.amountPerSwap) return false;
        return currentEpoch() >= p.lastExecutedEpoch + p.intervalInEpochs;
    }

    /// @notice Convenience helper for keepers — scans `positionIds` and returns just the ripe ones.
    function getRipePositions(uint256[] calldata positionIds) external view returns (uint256[] memory ripe) {
        uint256 len = positionIds.length;
        uint256[] memory buf = new uint256[](len);
        uint256 count;
        for (uint256 i = 0; i < len; i++) {
            if (isRipe(positionIds[i])) {
                buf[count++] = positionIds[i];
            }
        }
        ripe = new uint256[](count);
        for (uint256 j = 0; j < count; j++) ripe[j] = buf[j];
    }

    function getPositionsByOwner(address user) external view returns (uint256[] memory) {
        return positionsByOwner[user];
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    function _executeDCA(uint256 positionId, uint256 callerMinOut, bool useCallerMin)
        internal
        whenNotPaused
        returns (uint256 tokenReceived)
    {
        Position storage p = positions[positionId];
        if (!p.active) revert PositionInactive();
        if (!isRipe(positionId)) revert PositionNotRipe();
        if (p.usdcBalance < p.amountPerSwap) revert InsufficientBalance();

        uint256 amountPerSwap = p.amountPerSwap;
        uint256 keeperFee = (amountPerSwap * KEEPER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 protoFee = (amountPerSwap * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 burnFee = (amountPerSwap * BURN_FEE_BPS) / BPS_DENOMINATOR;
        uint256 swapAmount = amountPerSwap - keeperFee - protoFee - burnFee;

        // Determine minOut: caller override wins; otherwise consult quoter; otherwise 1.
        uint256 minOut;
        if (useCallerMin) {
            minOut = callerMinOut;
        } else {
            minOut = _quoteWithSlippage(p.swapPath, swapAmount, p.slippageBps);
        }

        // ── Effects (CEI: all state changes before any external call) ──
        p.usdcBalance -= amountPerSwap;
        p.lastExecutedEpoch = currentEpoch();
        protocolFeeBalance += protoFee;
        burnFeeBalance += burnFee;

        // ── Interactions ──
        // 1. Pay keeper their slice in USDC.
        if (keeperFee > 0) IERC20(USDC).safeTransfer(msg.sender, keeperFee);

        // 2. Swap. The router has a max approval from the constructor so we don't re-approve.
        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: p.swapPath,
            recipient: address(this),
            amountIn: swapAmount,
            amountOutMinimum: minOut
        });
        tokenReceived = ISwapRouter(SWAP_ROUTER).exactInput(params);

        // 3. Credit user's accrued balance (post-swap, no external call after this).
        p.tokenAccrued += tokenReceived;

        emit PositionExecuted(positionId, msg.sender, amountPerSwap, tokenReceived, keeperFee, p.lastExecutedEpoch);
    }

    /**
     * @dev Calls QuoterV2 in a try/catch. On failure returns 1 (effectively no protection).
     *      QuoterV2 is non-view: it uses revert-and-rewind. That's fine since we use try/catch.
     */
    function _quoteWithSlippage(bytes memory path, uint256 amountIn, uint256 slippageBps)
        internal
        returns (uint256 minOut)
    {
        try IQuoterV2(QUOTER).quoteExactInput(path, amountIn) returns (
            uint256 amountOut,
            uint160[] memory,
            uint32[] memory,
            uint256
        ) {
            // amountOut * (BPS - slippage) / BPS, careful with overflow (slippage ≤ MAX so subtraction safe).
            minOut = (amountOut * (BPS_DENOMINATOR - slippageBps)) / BPS_DENOMINATOR;
            if (minOut == 0) minOut = 1;
        } catch {
            minOut = 1;
        }
    }

    function _validateBurnPath(bytes memory path) internal pure {
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert InvalidPath();
        if (_firstToken(path) != USDC) revert PathTokenMismatch();
        if (_lastToken(path) != CLAWD) revert PathTokenMismatch();
    }

    function _firstToken(bytes memory path) internal pure returns (address token) {
        assembly {
            // load 32 bytes starting at path data offset, shift right 12 bytes to keep top 20.
            token := shr(96, mload(add(path, 32)))
        }
    }

    function _lastToken(bytes memory path) internal pure returns (address token) {
        uint256 len = path.length;
        assembly {
            // load 32 bytes ending at path[len-20 .. len], shift to keep just the last 20 bytes.
            token := shr(96, mload(add(add(path, 32), sub(len, 20))))
        }
    }
}
