// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Citrine test dollar
/// @notice Six-decimal test stablecoin used as the loan asset on Monad testnet.
///         Anyone can draw from the faucet once per cooldown window.
contract CitrineUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address account => uint256 timestamp) public lastDrip;

    event Drip(address indexed account, uint256 amount);

    error FaucetCoolingDown(uint256 availableAt);

    constructor() ERC20("Citrine Test USD", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
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
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Drip(msg.sender, FAUCET_AMOUNT);
    }
}
