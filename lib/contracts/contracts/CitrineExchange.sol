// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {PositionArt} from "./PositionArt.sol";

/// @title Citrine credit exchange
/// @notice Peer-to-peer fixed-term lending with market-discovered rates.
///
///         1. A borrower locks native MON as collateral and opens a request for a
///            fixed principal, term and maximum APR.
///         2. Lenders compete in a descending-rate auction. Each bid escrows the full
///            principal and must undercut the best rate; the outbid lender is refunded
///            in the same transaction. Bids near the close extend the auction.
///         3. The best bid funds the loan (on settlement, or earlier if the borrower
///            accepts it). The winning lender receives an ERC-721 position that
///            represents the right to be repaid.
///         4. Positions trade on a built-in secondary market. Whoever holds the
///            position when the loan closes receives the repayment, or the collateral.
///
///         Loans close by repayment, by default (unpaid after maturity plus a grace
///         period), or by liquidation when the loan-to-value ratio, measured with a
///         fresh Pyth price, crosses the liquidation threshold.
contract CitrineExchange is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum RequestStatus {
        None,
        Open,
        Funded,
        Cancelled,
        Expired
    }

    enum LoanStatus {
        None,
        Active,
        Repaid,
        Defaulted,
        Liquidated
    }

    struct Request {
        address borrower;
        uint40 createdAt;
        uint40 auctionEnd;
        RequestStatus status;
        uint128 principal;
        uint128 collateral;
        address bestBidder;
        uint32 duration;
        uint16 maxRateBps;
        uint16 bestRateBps;
        uint32 bidCount;
    }

    struct Loan {
        address borrower;
        uint40 startTime;
        uint40 maturity;
        uint16 rateBps;
        uint128 principal;
        uint128 collateral;
        address lender;
        LoanStatus status;
        uint40 closedAt;
    }

    struct Listing {
        address seller;
        uint128 price;
    }

    // ---------------------------------------------------------------------
    // Parameters
    // ---------------------------------------------------------------------

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_RATE_BPS = 10_000;
    uint256 public constant MIN_BID_STEP_BPS = 5;
    uint256 public constant MIN_DURATION = 5 minutes;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MIN_AUCTION = 1 minutes;
    uint256 public constant MAX_AUCTION = 7 days;
    uint256 public constant EXTENSION_WINDOW = 1 minutes;
    uint256 public constant MAX_GRACE = 1 days;
    uint256 public constant LIQUIDATION_LTV_BPS = 8_500;
    uint256 public constant LIQUIDATION_PENALTY_BPS = 500;
    uint256 public constant LIQUIDATOR_BOUNTY_BPS = 50;
    uint256 public constant MAX_PRICE_AGE = 120;
    uint256 private constant NATIVE_SEND_GAS = 100_000;

    IERC20 public immutable asset;
    uint8 public immutable assetDecimals;
    uint256 public immutable minPrincipal;
    IPyth public immutable pyth;
    bytes32 public immutable collateralPriceId;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public nextId = 1;

    mapping(uint256 id => Request) private _requests;
    mapping(uint256 id => Loan) private _loans;
    mapping(uint256 id => Listing) private _listings;

    /// @notice Payouts that could not be pushed to the recipient, withdrawable with `claim`.
    mapping(address account => uint256 amount) public claimableAsset;
    mapping(address account => uint256 amount) public claimableNative;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event RequestCreated(
        uint256 indexed id,
        address indexed borrower,
        uint256 principal,
        uint256 collateral,
        uint32 duration,
        uint16 maxRateBps,
        uint40 auctionEnd
    );
    event BidPlaced(
        uint256 indexed id, address indexed bidder, uint16 rateBps, uint40 auctionEnd, address previousBidder
    );
    event RequestCancelled(uint256 indexed id);
    event RequestExpired(uint256 indexed id);
    event LoanStarted(
        uint256 indexed id,
        address indexed borrower,
        address indexed lender,
        uint256 principal,
        uint256 collateral,
        uint16 rateBps,
        uint40 startTime,
        uint40 maturity
    );
    event LoanRepaid(uint256 indexed id, address indexed payer, address indexed holder, uint256 amount, uint256 interest);
    event LoanDefaulted(uint256 indexed id, address indexed holder, address indexed caller, uint256 collateral, uint256 bounty);
    event LoanLiquidated(
        uint256 indexed id,
        address indexed holder,
        address indexed caller,
        uint256 seized,
        uint256 bounty,
        uint256 returned,
        uint256 ltvBps
    );
    event Listed(uint256 indexed id, address indexed seller, uint256 price);
    event ListingCancelled(uint256 indexed id);
    event PositionSold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 price);
    event PayoutDeferred(address indexed account, uint256 amount, bool native);
    event Claimed(address indexed account, uint256 assetAmount, uint256 nativeAmount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidAmount();
    error InvalidDuration();
    error InvalidRate();
    error InvalidAuctionLength();
    error NotOpen();
    error AuctionClosed();
    error AuctionLive(uint256 endsAt);
    error SelfBid();
    error RateTooHigh(uint256 maxAllowedBps);
    error NoBids();
    error HasBids();
    error NotBorrower();
    error NotActive();
    error NotDefaulted(uint256 defaultAt);
    error Healthy(uint256 ltvBps);
    error NotPositionOwner();
    error NotListed();
    error PriceAboveMax(uint256 price);
    error OwnListing();
    error BadPrice();
    error InsufficientFee(uint256 required);
    error NothingToClaim();
    error NativeTransferFailed();

    constructor(IERC20 asset_, IPyth pyth_, bytes32 collateralPriceId_) ERC721("Citrine Loan Position", "CLP") {
        asset = asset_;
        uint8 decimals_ = IERC20Metadata(address(asset_)).decimals();
        assetDecimals = decimals_;
        minPrincipal = 10 ** decimals_;
        pyth = pyth_;
        collateralPriceId = collateralPriceId_;
    }

    // ---------------------------------------------------------------------
    // Borrowing
    // ---------------------------------------------------------------------

    /// @notice Open a loan request. `msg.value` is locked as collateral until the
    ///         request is cancelled, expires, or the resulting loan closes.
    function createRequest(uint128 principal, uint32 duration, uint16 maxRateBps, uint32 auctionLength)
        external
        payable
        returns (uint256 id)
    {
        if (principal < minPrincipal || msg.value == 0) revert InvalidAmount();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
        if (maxRateBps == 0 || maxRateBps > MAX_RATE_BPS) revert InvalidRate();
        if (auctionLength < MIN_AUCTION || auctionLength > MAX_AUCTION) revert InvalidAuctionLength();

        id = nextId++;
        uint40 auctionEnd = uint40(block.timestamp + auctionLength);

        Request storage r = _requests[id];
        r.borrower = msg.sender;
        r.createdAt = uint40(block.timestamp);
        r.auctionEnd = auctionEnd;
        r.status = RequestStatus.Open;
        r.principal = principal;
        r.collateral = msg.value.toUint128();
        r.duration = duration;
        r.maxRateBps = maxRateBps;

        emit RequestCreated(id, msg.sender, principal, msg.value, duration, maxRateBps, auctionEnd);
    }

    /// @notice Fund the request immediately at the current best rate.
    function acceptBid(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Open) revert NotOpen();
        if (msg.sender != r.borrower) revert NotBorrower();
        if (r.bestBidder == address(0)) revert NoBids();
        _fund(id, r);
    }

    /// @notice Withdraw a request that has not received a bid yet.
    function cancelRequest(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Open) revert NotOpen();
        if (msg.sender != r.borrower) revert NotBorrower();
        if (r.bestBidder != address(0)) revert HasBids();
        r.status = RequestStatus.Cancelled;
        emit RequestCancelled(id);
        _payNative(r.borrower, r.collateral);
    }

    /// @notice Pay back principal plus accrued interest. Anyone may repay on behalf
    ///         of the borrower; the collateral always returns to the borrower.
    function repay(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Active) revert NotActive();
        (uint256 owed, uint256 interest) = _debt(l.principal, l.rateBps, l.startTime);
        address holder = _ownerOf(id);

        l.status = LoanStatus.Repaid;
        l.closedAt = uint40(block.timestamp);
        _burn(id);

        asset.safeTransferFrom(msg.sender, address(this), owed);
        emit LoanRepaid(id, msg.sender, holder, owed, interest);
        _payAsset(holder, owed);
        _payNative(l.borrower, l.collateral);
    }

    // ---------------------------------------------------------------------
    // Lending
    // ---------------------------------------------------------------------

    /// @notice Offer to fund request `id` at `rateBps` APR. Escrows the full principal;
    ///         the previous best bidder is refunded.
    function bid(uint256 id, uint16 rateBps) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Open) revert NotOpen();
        if (block.timestamp >= r.auctionEnd) revert AuctionClosed();
        if (msg.sender == r.borrower) revert SelfBid();
        if (rateBps == 0) revert InvalidRate();

        address previous = r.bestBidder;
        uint256 ceiling;
        if (previous == address(0)) {
            ceiling = r.maxRateBps;
        } else if (r.bestRateBps > MIN_BID_STEP_BPS) {
            ceiling = r.bestRateBps - MIN_BID_STEP_BPS;
        }
        if (rateBps > ceiling) revert RateTooHigh(ceiling);

        r.bestBidder = msg.sender;
        r.bestRateBps = rateBps;
        r.bidCount += 1;

        uint40 auctionEnd = r.auctionEnd;
        if (auctionEnd - block.timestamp < EXTENSION_WINDOW) {
            auctionEnd = uint40(block.timestamp + EXTENSION_WINDOW);
            r.auctionEnd = auctionEnd;
        }

        emit BidPlaced(id, msg.sender, rateBps, auctionEnd, previous);

        if (previous != msg.sender) {
            uint256 amount = r.principal;
            asset.safeTransferFrom(msg.sender, address(this), amount);
            if (previous != address(0)) _payAsset(previous, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Keepers (callable by anyone)
    // ---------------------------------------------------------------------

    /// @notice Fund a request whose auction has ended with at least one bid.
    function settle(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Open) revert NotOpen();
        if (block.timestamp < r.auctionEnd) revert AuctionLive(r.auctionEnd);
        if (r.bestBidder == address(0)) revert NoBids();
        _fund(id, r);
    }

    /// @notice Close a request whose auction ended without bids and return the collateral.
    function expireRequest(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Open) revert NotOpen();
        if (block.timestamp < r.auctionEnd) revert AuctionLive(r.auctionEnd);
        if (r.bestBidder != address(0)) revert HasBids();
        r.status = RequestStatus.Expired;
        emit RequestExpired(id);
        _payNative(r.borrower, r.collateral);
    }

    /// @notice Seize the collateral of a loan that is unpaid past maturity plus grace.
    ///         The position holder receives the collateral minus a small caller bounty.
    function claimDefault(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Active) revert NotActive();
        uint256 due = _defaultAt(l);
        if (block.timestamp < due) revert NotDefaulted(due);

        address holder = _ownerOf(id);
        l.status = LoanStatus.Defaulted;
        l.closedAt = uint40(block.timestamp);
        _burn(id);

        uint256 collateral = l.collateral;
        uint256 bounty = msg.sender == holder ? 0 : (collateral * LIQUIDATOR_BOUNTY_BPS) / BPS;
        emit LoanDefaulted(id, holder, msg.sender, collateral - bounty, bounty);
        _payNative(holder, collateral - bounty);
        if (bounty != 0) _payNative(msg.sender, bounty);
    }

    /// @notice Liquidate a loan whose loan-to-value ratio is at or above the threshold.
    ///         `priceUpdate` is a signed Pyth update from Hermes; send its update fee
    ///         as `msg.value` (any excess is refunded). The holder receives collateral
    ///         worth the debt plus the liquidation penalty; the rest returns to the borrower.
    function liquidate(uint256 id, bytes[] calldata priceUpdate) external payable nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Active) revert NotActive();

        uint256 fee = pyth.getUpdateFee(priceUpdate);
        if (msg.value < fee) revert InsufficientFee(fee);
        pyth.updatePriceFeeds{value: fee}(priceUpdate);
        PythStructs.Price memory price = pyth.getPriceNoOlderThan(collateralPriceId, MAX_PRICE_AGE);

        (uint256 owed,) = _debt(l.principal, l.rateBps, l.startTime);
        uint256 collateral = l.collateral;
        uint256 ltv = _ltvBps(owed, collateral, price);
        if (ltv < LIQUIDATION_LTV_BPS) revert Healthy(ltv);

        address holder = _ownerOf(id);
        l.status = LoanStatus.Liquidated;
        l.closedAt = uint40(block.timestamp);
        _burn(id);

        uint256 seized = _assetToCollateral((owed * (BPS + LIQUIDATION_PENALTY_BPS)) / BPS, price);
        if (seized > collateral) seized = collateral;
        uint256 bounty = msg.sender == holder ? 0 : (seized * LIQUIDATOR_BOUNTY_BPS) / BPS;
        uint256 returned = collateral - seized;

        emit LoanLiquidated(id, holder, msg.sender, seized - bounty, bounty, returned, ltv);
        _payNative(holder, seized - bounty);
        if (bounty != 0) _payNative(msg.sender, bounty);
        if (returned != 0) _payNative(l.borrower, returned);
        if (msg.value > fee) _payNative(msg.sender, msg.value - fee);
    }

    // ---------------------------------------------------------------------
    // Secondary market
    // ---------------------------------------------------------------------

    /// @notice List a position for sale at a fixed price in the loan asset. The
    ///         position stays in the seller's wallet until it is bought.
    function list(uint256 id, uint128 price) external {
        if (_loans[id].status != LoanStatus.Active) revert NotActive();
        if (_ownerOf(id) != msg.sender) revert NotPositionOwner();
        if (price == 0) revert InvalidAmount();
        _listings[id] = Listing({seller: msg.sender, price: price});
        emit Listed(id, msg.sender, price);
    }

    function cancelListing(uint256 id) external {
        Listing memory listing = _listings[id];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.seller != msg.sender) revert NotPositionOwner();
        delete _listings[id];
        emit ListingCancelled(id);
    }

    /// @notice Buy a listed position. Reverts if the price is above `maxPrice`.
    function buy(uint256 id, uint128 maxPrice) external nonReentrant {
        Listing memory listing = _listings[id];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.seller == msg.sender) revert OwnListing();
        if (_loans[id].status != LoanStatus.Active) revert NotActive();
        if (listing.price > maxPrice) revert PriceAboveMax(listing.price);

        delete _listings[id];
        _transfer(listing.seller, msg.sender, id);
        asset.safeTransferFrom(msg.sender, listing.seller, listing.price);
        emit PositionSold(id, listing.seller, msg.sender, listing.price);
    }

    // ---------------------------------------------------------------------
    // Deferred payouts
    // ---------------------------------------------------------------------

    function claim() external nonReentrant {
        uint256 assetAmount = claimableAsset[msg.sender];
        uint256 nativeAmount = claimableNative[msg.sender];
        if (assetAmount == 0 && nativeAmount == 0) revert NothingToClaim();
        claimableAsset[msg.sender] = 0;
        claimableNative[msg.sender] = 0;
        emit Claimed(msg.sender, assetAmount, nativeAmount);
        if (assetAmount != 0) asset.safeTransfer(msg.sender, assetAmount);
        if (nativeAmount != 0) {
            (bool ok,) = msg.sender.call{value: nativeAmount}("");
            if (!ok) revert NativeTransferFailed();
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function getLoan(uint256 id) external view returns (Loan memory) {
        return _loans[id];
    }

    function getListing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    /// @notice Amount required to repay loan `id` right now.
    function debtOf(uint256 id) public view returns (uint256 owed, uint256 interest) {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Active) return (0, 0);
        return _debt(l.principal, l.rateBps, l.startTime);
    }

    /// @notice Timestamp from which an unpaid loan can be claimed as defaulted.
    function defaultAt(uint256 id) external view returns (uint256) {
        return _defaultAt(_loans[id]);
    }

    function gracePeriod(uint256 duration) public pure returns (uint256) {
        uint256 grace = duration / 10;
        return grace > MAX_GRACE ? MAX_GRACE : grace;
    }

    /// @notice Simple interest on `principal` at `rateBps` APR over `elapsed` seconds, rounded up.
    function quoteInterest(uint256 principal, uint256 rateBps, uint256 elapsed) public pure returns (uint256) {
        return Math.mulDiv(principal * rateBps, elapsed, BPS * YEAR, Math.Rounding.Ceil);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Loan storage l = _loans[id];
        (uint256 owed,) = _debt(l.principal, l.rateBps, l.startTime);
        return PositionArt.tokenURI(
            PositionArt.Position({
                id: id,
                principal: l.principal,
                owed: owed,
                collateral: l.collateral,
                rateBps: l.rateBps,
                startTime: l.startTime,
                maturity: l.maturity,
                now_: block.timestamp,
                assetDecimals: assetDecimals,
                assetSymbol: IERC20Metadata(address(asset)).symbol()
            })
        );
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _fund(uint256 id, Request storage r) private {
        r.status = RequestStatus.Funded;
        address lender = r.bestBidder;
        uint40 startTime = uint40(block.timestamp);
        uint40 maturity = startTime + r.duration;

        Loan storage l = _loans[id];
        l.borrower = r.borrower;
        l.startTime = startTime;
        l.maturity = maturity;
        l.rateBps = r.bestRateBps;
        l.principal = r.principal;
        l.collateral = r.collateral;
        l.lender = lender;
        l.status = LoanStatus.Active;

        // _mint rather than _safeMint: a lender contract without onERC721Received
        // must not be able to block settlement.
        _mint(lender, id);
        emit LoanStarted(id, r.borrower, lender, r.principal, r.collateral, r.bestRateBps, startTime, maturity);
        _payAsset(r.borrower, r.principal);
    }

    function _debt(uint256 principal, uint256 rateBps, uint256 startTime)
        private
        view
        returns (uint256 owed, uint256 interest)
    {
        interest = quoteInterest(principal, rateBps, block.timestamp - startTime);
        owed = principal + interest;
    }

    function _defaultAt(Loan storage l) private view returns (uint256) {
        if (l.status == LoanStatus.None) return 0;
        return uint256(l.maturity) + gracePeriod(uint256(l.maturity) - l.startTime);
    }

    /// @dev Value of `amount` wei of collateral, denominated in loan-asset units.
    ///      Assumes the loan asset is a dollar stablecoin.
    function _collateralValue(uint256 amount, PythStructs.Price memory price) private view returns (uint256) {
        if (price.price <= 0) revert BadPrice();
        uint256 p = uint256(uint64(price.price));
        int256 exp = int256(price.expo) + int256(uint256(assetDecimals)) - 18;
        if (exp >= 0) return amount * p * 10 ** uint256(exp);
        return Math.mulDiv(amount, p, 10 ** uint256(-exp));
    }

    /// @dev Inverse of `_collateralValue`: wei of collateral worth `value` asset units.
    function _assetToCollateral(uint256 value, PythStructs.Price memory price) private view returns (uint256) {
        if (price.price <= 0) revert BadPrice();
        uint256 p = uint256(uint64(price.price));
        int256 exp = int256(price.expo) + int256(uint256(assetDecimals)) - 18;
        if (exp >= 0) return value / (p * 10 ** uint256(exp));
        return Math.mulDiv(value, 10 ** uint256(-exp), p);
    }

    function _ltvBps(uint256 owed, uint256 collateral, PythStructs.Price memory price)
        private
        view
        returns (uint256)
    {
        uint256 value = _collateralValue(collateral, price);
        if (value == 0) return type(uint256).max;
        return Math.mulDiv(owed, BPS, value);
    }

    function _payAsset(address to, uint256 amount) private {
        if (!asset.trySafeTransfer(to, amount)) {
            claimableAsset[to] += amount;
            emit PayoutDeferred(to, amount, false);
        }
    }

    function _payNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount, gas: NATIVE_SEND_GAS}("");
        if (!ok) {
            claimableNative[to] += amount;
            emit PayoutDeferred(to, amount, true);
        }
    }

    /// @dev Any movement of a position (sale, transfer, burn) clears its listing.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (_listings[tokenId].seller != address(0)) {
            delete _listings[tokenId];
            emit ListingCancelled(tokenId);
        }
    }
}
