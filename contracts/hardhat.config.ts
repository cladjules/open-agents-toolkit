import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

import { configVariable, defineConfig } from "hardhat/config";
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
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
