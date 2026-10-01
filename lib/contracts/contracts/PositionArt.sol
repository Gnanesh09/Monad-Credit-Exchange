// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Position artwork
/// @notice Renders the fully onchain metadata and card image for a loan position.
library PositionArt {
    using Strings for uint256;

    struct Position {
        uint256 id;
        uint256 principal;
        uint256 owed;
        uint256 collateral;
        uint16 rateBps;
        uint40 startTime;
        uint40 maturity;
        uint256 now_;
        uint8 assetDecimals;
        string assetSymbol;
    }

    string private constant ACCENT = "#F5E04B";
    string private constant INK = "#F5F5F4";
    string private constant MUTED = "#8A8A8E";

    function tokenURI(Position memory p) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"Citrine position #',
            p.id.toString(),
            '","description":"Transferable claim on a Citrine loan. The holder is repaid principal plus interest, or receives the collateral if the borrower defaults.",',
            '"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(p))),
            '","attributes":[',
            _attributes(p),
            "]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attributes(Position memory p) private pure returns (string memory) {
        return string.concat(
            '{"trait_type":"Principal","value":',
            _decimal(p.principal, p.assetDecimals, 2),
            '},{"trait_type":"APR","value":',
            _decimal(p.rateBps, 2, 2),
            '},{"trait_type":"Collateral (MON)","value":',
            _decimal(p.collateral, 18, 4),
            '},{"display_type":"date","trait_type":"Maturity","value":',
            uint256(p.maturity).toString(),
            "}"
        );
    }

    function _svg(Position memory p) private pure returns (string memory) {
        uint256 term = uint256(p.maturity) - p.startTime;
        uint256 elapsed = p.now_ > p.startTime ? p.now_ - p.startTime : 0;
        if (elapsed > term) elapsed = term;
        uint256 bar = term == 0 ? 320 : (elapsed * 320) / term;
        string memory timing = p.now_ < p.maturity
            ? string.concat("Matures in ", _span(p.maturity - p.now_))
            : string.concat("Matured ", _span(p.now_ - p.maturity), " ago");
        return string.concat(_frame(p.id), _figures(p, bar, timing), "</svg>");
    }

    function _frame(uint256 id) private pure returns (string memory) {
        return string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400' font-family='Inter,Helvetica,Arial,sans-serif'>",
            "<defs><radialGradient id='g' cx='88%' cy='8%' r='80%'><stop offset='0' stop-color='",
            ACCENT,
            "' stop-opacity='0.32'/><stop offset='1' stop-color='",
            ACCENT,
            "' stop-opacity='0'/></radialGradient></defs>",
            "<rect width='400' height='400' rx='28' fill='#0B0B0C'/><rect width='400' height='400' rx='28' fill='url(#g)'/>",
            "<circle cx='50' cy='52' r='9' fill='",
            ACCENT,
            "'/><text x='68' y='57' fill='",
            INK,
            "' font-size='15'>Citrine</text><text x='360' y='57' fill='",
            MUTED,
            "' font-size='13' text-anchor='end'>Position #",
            id.toString(),
            "</text>"
        );
    }

    function _figures(Position memory p, uint256 bar, string memory timing) private pure returns (string memory) {
        return string.concat(
            string.concat(
                "<text x='40' y='150' fill='",
                MUTED,
                "' font-size='13'>Principal</text><text x='40' y='192' fill='",
                INK,
                "' font-size='38'>",
                _decimal(p.principal, p.assetDecimals, 2),
                " <tspan fill='",
                MUTED,
                "' font-size='18'>",
                p.assetSymbol,
                "</tspan></text><text x='40' y='228' fill='",
                ACCENT,
                "' font-size='18'>",
                _decimal(p.rateBps, 2, 2),
                "% APR</text>"
            ),
            string.concat(
                "<rect x='40' y='262' width='320' height='6' rx='3' fill='#232326'/><rect x='40' y='262' width='",
                bar.toString(),
                "' height='6' rx='3' fill='",
                ACCENT,
                "'/><text x='40' y='296' fill='",
                MUTED,
                "' font-size='13'>",
                timing,
                "</text>"
            ),
            string.concat(
                "<text x='40' y='346' fill='",
                INK,
                "' font-size='14'>Owed ",
                _decimal(p.owed, p.assetDecimals, 2),
                "</text><text x='360' y='346' fill='",
                INK,
                "' font-size='14' text-anchor='end'>",
                _decimal(p.collateral, 18, 4),
                " MON</text>"
            )
        );
    }

    function _decimal(uint256 value, uint8 decimals, uint8 shown) private pure returns (string memory) {
        if (shown > decimals) shown = decimals;
        uint256 unit = 10 ** decimals;
        uint256 whole = value / unit;
        if (shown == 0) return whole.toString();
        bytes memory digits = bytes(((value % unit) / 10 ** (decimals - shown)).toString());
        bytes memory padded = new bytes(shown);
        uint256 pad = shown - digits.length;
        for (uint256 i = 0; i < shown; i++) {
            padded[i] = i < pad ? bytes1("0") : digits[i - pad];
        }
        return string.concat(whole.toString(), ".", string(padded));
    }

    function _span(uint256 s) private pure returns (string memory) {
        if (s >= 1 days) {
            return string.concat((s / 1 days).toString(), "d ", ((s % 1 days) / 1 hours).toString(), "h");
        }
        if (s >= 1 hours) {
            return string.concat((s / 1 hours).toString(), "h ", ((s % 1 hours) / 1 minutes).toString(), "m");
        }
        if (s >= 1 minutes) return string.concat((s / 1 minutes).toString(), "m");
        return string.concat(s.toString(), "s");
    }
}
