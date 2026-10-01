// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {CitrineExchange} from "../CitrineExchange.sol";

/// @dev Borrower contract that can refuse native transfers, used to exercise deferred payouts.
contract RejectingBorrower {
    CitrineExchange public immutable exchange;
    bool public accepting;

    constructor(CitrineExchange exchange_) {
        exchange = exchange_;
    }

    function open(uint128 principal, uint32 duration, uint16 maxRateBps, uint32 auctionLength)
        external
        payable
        returns (uint256)
    {
        return exchange.createRequest{value: msg.value}(principal, duration, maxRateBps, auctionLength);
    }

    function cancel(uint256 id) external {
        exchange.cancelRequest(id);
    }

    function setAccepting(bool value) external {
        accepting = value;
    }

    function claim() external {
        exchange.claim();
    }

    receive() external payable {
        require(accepting, "rejecting");
    }
}

/// @dev Keeps MockPyth in the compilation so tests can deploy it.
abstract contract PythMockAnchor is MockPyth {}
