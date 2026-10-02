// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AuthorisedMockSignersBase} from "@redstone-finance/evm-connector/contracts/mocks/AuthorisedMockSignersBase.sol";
import {CitrineExchange} from "../CitrineExchange.sol";

/// @dev The exchange with RedStone's mock signers (the default Hardhat accounts) in place of
///      the production nodes, so tests can sign their own price payloads.
contract CitrineExchangeHarness is CitrineExchange, AuthorisedMockSignersBase {
    constructor(IERC20 asset_, CollateralInit[] memory collaterals) CitrineExchange(asset_, collaterals) {}

    function getAuthorisedSignerIndex(address signer) public view override returns (uint8) {
        return getAllMockAuthorised(signer);
    }
}

/// @dev Borrower contract that can refuse native transfers, used to exercise deferred payouts.
contract RejectingBorrower {
    CitrineExchange public immutable exchange;
    bool public accepting;

    constructor(CitrineExchange exchange_) {
        exchange = exchange_;
    }

    /// @dev Opens a request backed by native MON (collateral type 0).
    function open(uint128 principal, uint32 duration, uint16 maxRateBps, uint32 auctionLength)
        external
        payable
        returns (uint256)
    {
        return exchange.createRequest{value: msg.value}(
            0, uint128(msg.value), principal, duration, maxRateBps, auctionLength
        );
    }

    function cancel(uint256 id) external {
        exchange.cancelRequest(id);
    }

    function setAccepting(bool value) external {
        accepting = value;
    }

    function claim() external {
        exchange.claim(address(0));
    }

    receive() external payable {
        require(accepting, "rejecting");
    }
}
