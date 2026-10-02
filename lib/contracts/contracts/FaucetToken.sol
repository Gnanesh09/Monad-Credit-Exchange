// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Faucet token
/// @notice Test token for Monad testnet. Anyone can draw a fixed amount once per
///         cooldown window. Used for the loan asset (tUSDC) and the test collaterals
///         (tWETH, tWBTC), which the exchange prices with live RedStone feeds.
contract FaucetToken is ERC20 {
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    uint8 private immutable _decimals;
    uint256 public immutable dripAmount;

    mapping(address account => uint256 timestamp) public lastDrip;

    event Drip(address indexed account, uint256 amount);

    error FaucetCoolingDown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 dripAmount_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        dripAmount = dripAmount_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Timestamp after which `account` can use the faucet again.
    function nextDripAt(address account) public view returns (uint256) {
        uint256 last = lastDrip[account];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }

    function faucet() external {
        uint256 availableAt = nextDripAt(msg.sender);
        if (block.timestamp < availableAt) revert FaucetCoolingDown(availableAt);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, dripAmount);
        emit Drip(msg.sender, dripAmount);
    }
}
