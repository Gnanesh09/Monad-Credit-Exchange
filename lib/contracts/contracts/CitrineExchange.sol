// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {PrimaryProdDataServiceConsumerBase} from
    "@redstone-finance/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol";
import {PositionArt} from "./PositionArt.sol";

/// @title Citrine credit exchange
/// @notice Peer-to-peer fixed-term lending with market-discovered rates.
///
///         1. A borrower locks collateral (native MON or an accepted token) and opens
///            a request for a fixed principal, term and maximum APR.
///         2. Lenders compete in a descending-rate auction. Each bid escrows the full
///            principal and must undercut the best rate; the outbid lender is refunded
///            in the same transaction. Bids near the close extend the auction.
///         3. The best bid funds the loan, on settlement or earlier if the borrower
///            accepts it. The winning lender receives an ERC-721 position that carries
///            the right to be repaid.
///         4. Positions trade on a built-in secondary market. Whoever holds the
///            position when the loan closes receives the repayment, or the collateral.
///
///         Loans close by repayment, by default (unpaid after maturity plus a grace
///         period), or by liquidation once the loan-to-value ratio, measured with a
///         fresh RedStone price, reaches the liquidation threshold.
///
///         The contract has no owner and no upgrade path. The loan asset is assumed to
///         be a dollar stablecoin; collateral is valued with its RedStone USD feed,
///         signed by RedStone's primary production nodes and delivered in calldata.
contract CitrineExchange is ERC721, ReentrancyGuard, PrimaryProdDataServiceConsumerBase {
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

    /// @notice Collateral accepted by the exchange. `token` is address(0) for native MON.
    ///         `feedId` is the RedStone data feed that prices it in USD, such as "ETH".
    struct CollateralType {
        address token;
        uint8 decimals;
        bytes32 feedId;
        string symbol;
    }

    struct CollateralInit {
        address token;
        bytes32 feedId;
    }

    struct Request {
        address borrower;
        uint40 createdAt;
        uint40 auctionEnd;
        RequestStatus status;
        uint8 collateralType;
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
        uint8 collateralType;
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
    uint256 private constant MAX_CLOCK_SKEW = 1 minutes;
    /// @dev RedStone numeric values carry eight decimals.
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant MAX_COLLATERAL_TYPES = 16;
    uint256 private constant NATIVE_SEND_GAS = 100_000;

    IERC20 public immutable asset;
    uint8 public immutable assetDecimals;
    uint256 public immutable minPrincipal;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    uint256 public nextId = 1;

    CollateralType[] private _collateralTypes;
    mapping(uint256 id => Request) private _requests;
    mapping(uint256 id => Loan) private _loans;
    mapping(uint256 id => Listing) private _listings;

    /// @notice Payouts that could not be pushed to the recipient, keyed by token
    ///         (address(0) for native MON). Withdraw with `claim`.
    mapping(address token => mapping(address account => uint256 amount)) public claimable;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event RequestCreated(
        uint256 indexed id,
        address indexed borrower,
        uint8 collateralType,
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
    event PayoutDeferred(address indexed account, address indexed token, uint256 amount);
    event Claimed(address indexed account, address indexed token, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidAmount();
    error InvalidDuration();
    error InvalidRate();
    error InvalidAuctionLength();
    error InvalidCollateralConfig();
    error UnknownCollateral();
    error ValueMismatch();
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
    error StalePrice(uint256 signedAt);
    error PriceFromFuture(uint256 signedAt);
    error NothingToClaim();
    error NativeTransferFailed();

    constructor(IERC20 asset_, CollateralInit[] memory collaterals)
        ERC721("Citrine Loan Position", "CLP")
    {
        if (collaterals.length == 0 || collaterals.length > MAX_COLLATERAL_TYPES) revert InvalidCollateralConfig();
        asset = asset_;
        uint8 decimals_ = IERC20Metadata(address(asset_)).decimals();
        assetDecimals = decimals_;
        minPrincipal = 10 ** decimals_;

        for (uint256 i = 0; i < collaterals.length; i++) {
            CollateralInit memory c = collaterals[i];
            if (c.feedId == bytes32(0) || c.token == address(asset_)) revert InvalidCollateralConfig();
            if (c.token == address(0)) {
                _collateralTypes.push(CollateralType(address(0), 18, c.feedId, "MON"));
            } else {
                IERC20Metadata t = IERC20Metadata(c.token);
                _collateralTypes.push(CollateralType(c.token, t.decimals(), c.feedId, t.symbol()));
            }
        }
    }

    // ---------------------------------------------------------------------
    // Borrowing
    // ---------------------------------------------------------------------

    /// @notice Open a loan request. The collateral is locked until the request is
    ///         cancelled or expires, or the resulting loan closes. For native MON send
    ///         `collateralAmount` as `msg.value`; for tokens approve the exchange first.
    function createRequest(
        uint8 collateralType,
        uint128 collateralAmount,
        uint128 principal,
        uint32 duration,
        uint16 maxRateBps,
        uint32 auctionLength
    ) external payable nonReentrant returns (uint256 id) {
        if (collateralType >= _collateralTypes.length) revert UnknownCollateral();
        if (principal < minPrincipal || collateralAmount == 0) revert InvalidAmount();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
        if (maxRateBps == 0 || maxRateBps > MAX_RATE_BPS) revert InvalidRate();
        if (auctionLength < MIN_AUCTION || auctionLength > MAX_AUCTION) revert InvalidAuctionLength();

        uint256 received;
        address token = _collateralTypes[collateralType].token;
        if (token == address(0)) {
            if (msg.value != collateralAmount) revert ValueMismatch();
            received = msg.value;
        } else {
            if (msg.value != 0) revert ValueMismatch();
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), collateralAmount);
            received = IERC20(token).balanceOf(address(this)) - balanceBefore;
            if (received == 0) revert InvalidAmount();
        }

        id = nextId++;
        uint40 auctionEnd = uint40(block.timestamp + auctionLength);

        Request storage r = _requests[id];
        r.borrower = msg.sender;
        r.createdAt = uint40(block.timestamp);
        r.auctionEnd = auctionEnd;
        r.status = RequestStatus.Open;
        r.collateralType = collateralType;
        r.principal = principal;
        r.collateral = received.toUint128();
        r.duration = duration;
        r.maxRateBps = maxRateBps;

        emit RequestCreated(id, msg.sender, collateralType, principal, received, duration, maxRateBps, auctionEnd);
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
        _payCollateral(r.collateralType, r.borrower, r.collateral);
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
        _payToken(asset, holder, owed);
        _payCollateral(l.collateralType, l.borrower, l.collateral);
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
            if (previous != address(0)) _payToken(asset, previous, amount);
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
        _payCollateral(r.collateralType, r.borrower, r.collateral);
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
        _payCollateral(l.collateralType, holder, collateral - bounty);
        if (bounty != 0) _payCollateral(l.collateralType, msg.sender, bounty);
    }

    /// @notice Liquidate a loan whose loan-to-value ratio is at or above the threshold.
    ///         The caller appends a RedStone payload for the collateral's feed to the
    ///         calldata: prices signed by at least three of RedStone's primary production
    ///         nodes, no older than MAX_PRICE_AGE. The median is used. The holder receives
    ///         collateral worth the debt plus the liquidation penalty; the remainder
    ///         returns to the borrower.
    function liquidate(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Active) revert NotActive();
        CollateralType storage c = _collateralTypes[l.collateralType];
        uint256 price = getOracleNumericValueFromTxMsg(c.feedId);

        (uint256 owed,) = _debt(l.principal, l.rateBps, l.startTime);
        uint256 collateral = l.collateral;
        uint256 ltv = _ltvBps(owed, collateral, price, c.decimals);
        if (ltv < LIQUIDATION_LTV_BPS) revert Healthy(ltv);

        address holder = _ownerOf(id);
        l.status = LoanStatus.Liquidated;
        l.closedAt = uint40(block.timestamp);
        _burn(id);

        uint256 seized = _toCollateral((owed * (BPS + LIQUIDATION_PENALTY_BPS)) / BPS, price, c.decimals);
        if (seized > collateral) seized = collateral;
        uint256 bounty = msg.sender == holder ? 0 : (seized * LIQUIDATOR_BOUNTY_BPS) / BPS;
        uint256 returned = collateral - seized;

        emit LoanLiquidated(id, holder, msg.sender, seized - bounty, bounty, returned, ltv);
        uint8 kind = l.collateralType;
        _payCollateral(kind, holder, seized - bounty);
        if (bounty != 0) _payCollateral(kind, msg.sender, bounty);
        if (returned != 0) _payCollateral(kind, l.borrower, returned);
    }

    /// @notice Called by the RedStone base with the signed packages' timestamp, in
    ///         milliseconds. Prices older than MAX_PRICE_AGE are refused, and so are
    ///         prices more than a minute ahead of the block clock.
    function validateTimestamp(uint256 receivedTimestampMilliseconds) public view override {
        uint256 signedAt = receivedTimestampMilliseconds / 1000;
        if (signedAt > block.timestamp + MAX_CLOCK_SKEW) revert PriceFromFuture(signedAt);
        if (block.timestamp > signedAt + MAX_PRICE_AGE) revert StalePrice(signedAt);
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

    /// @notice Withdraw a deferred payout. `token` is address(0) for native MON.
    function claim(address token) external nonReentrant {
        uint256 amount = claimable[token][msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[token][msg.sender] = 0;
        emit Claimed(msg.sender, token, amount);
        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function collateralTypes() external view returns (CollateralType[] memory) {
        return _collateralTypes;
    }

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
    function debtOf(uint256 id) external view returns (uint256 owed, uint256 interest) {
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
        CollateralType storage c = _collateralTypes[l.collateralType];
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
                assetSymbol: IERC20Metadata(address(asset)).symbol(),
                collateralDecimals: c.decimals,
                collateralSymbol: c.symbol
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
        l.collateralType = r.collateralType;

        // _mint rather than _safeMint: a lender contract without onERC721Received
        // must not be able to block settlement.
        _mint(lender, id);
        emit LoanStarted(id, r.borrower, lender, r.principal, r.collateral, r.bestRateBps, startTime, maturity);
        _payToken(asset, r.borrower, r.principal);
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

    /// @dev Power of ten that converts collateral units times price into asset units.
    function _scale(uint256 price, uint8 collateralDecimals) private view returns (int256) {
        if (price == 0) revert BadPrice();
        return int256(uint256(assetDecimals)) - int256(uint256(collateralDecimals)) - int256(PRICE_DECIMALS);
    }

    /// @dev Value of `amount` collateral units, in loan-asset units.
    function _collateralValue(uint256 amount, uint256 price, uint8 collateralDecimals) private view returns (uint256) {
        int256 exp = _scale(price, collateralDecimals);
        if (exp >= 0) return Math.mulDiv(amount, price * 10 ** uint256(exp), 1);
        return Math.mulDiv(amount, price, 10 ** uint256(-exp));
    }

    /// @dev Collateral units worth `value` loan-asset units.
    function _toCollateral(uint256 value, uint256 price, uint8 collateralDecimals) private view returns (uint256) {
        int256 exp = _scale(price, collateralDecimals);
        if (exp >= 0) return value / (price * 10 ** uint256(exp));
        return Math.mulDiv(value, 10 ** uint256(-exp), price);
    }

    function _ltvBps(uint256 owed, uint256 collateral, uint256 price, uint8 collateralDecimals)
        private
        view
        returns (uint256)
    {
        uint256 value = _collateralValue(collateral, price, collateralDecimals);
        if (value == 0) return type(uint256).max;
        return Math.mulDiv(owed, BPS, value);
    }

    function _payCollateral(uint8 kind, address to, uint256 amount) private {
        address token = _collateralTypes[kind].token;
        if (token == address(0)) _payNative(to, amount);
        else _payToken(IERC20(token), to, amount);
    }

    function _payToken(IERC20 token, address to, uint256 amount) private {
        if (!token.trySafeTransfer(to, amount)) {
            claimable[address(token)][to] += amount;
            emit PayoutDeferred(to, address(token), amount);
        }
    }

    function _payNative(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount, gas: NATIVE_SEND_GAS}("");
        if (!ok) {
            claimable[address(0)][to] += amount;
            emit PayoutDeferred(to, address(0), amount);
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
