import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

import { configVariable, defineConfig } from "hardhat/config";

const zeroGExplorerUrl =  "https://chainscan-galileo.0g.ai";
const zeroGExplorerApiUrl = "https://chainscan-galileo.0g.ai/open/api";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  chainDescriptors: {
    16602: {
      name: "0G Galileo Testnet",
      chainType: "l1",
      blockExplorers: {
        blockscout: {
          name: "0G ChainScan Galileo",
          url: zeroGExplorerUrl,
          apiUrl: zeroGExplorerApiUrl,
        },
      },
    },
  },
  paths: {
    sources: "./src",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.35",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.35",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
    zeroGGalileo: {
      type: "http",
      chainType: "l1",
      chainId: 16602,
      url: configVariable("ZERO_G_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
