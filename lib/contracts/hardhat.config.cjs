require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");

// Only a well-formed 32-byte key is passed to the network config, so compiling
// and local tests work even when the deployer secret is missing or malformed.
// scripts/deploy.cjs reports a clear error in that case.
function deployerAccounts() {
  const raw = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? [key] : [];
}

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // Monad allows contracts up to 128 KB; the local network mirrors that.
      allowUnlimitedContractSize: true,
    },
    monadTestnet: {
      url: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: deployerAccounts(),
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadexplorer.com",
  },
  etherscan: {
    enabled: false,
  },
  mocha: {
    timeout: 120000,
  },
};
