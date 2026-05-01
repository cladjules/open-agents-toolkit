import type { Chain } from "viem";

export type ZeroGChainId = 16602 | 16661;

export type ZeroGConfig = {
  chainId: ZeroGChainId;
  chainName: string;
  rpcUrl: string;
  indexerUrl: string;
  blockExplorerName: string;
  blockExplorerUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  testnet: boolean;
};

const ZERO_G_CONFIG_BY_CHAIN_ID: Record<ZeroGChainId, ZeroGConfig> = {
  16602: {
    chainId: 16602,
    chainName: "0G Galileo Testnet",
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    blockExplorerName: "0G Galileo Chainscan",
    blockExplorerUrl: "https://chainscan-galileo.0g.ai",
    nativeCurrency: {
      name: "OG",
      symbol: "OG",
      decimals: 18,
    },
    testnet: true,
  },
  16661: {
    chainId: 16661,
    chainName: "0G Mainnet",
    rpcUrl: "https://evmrpc.0g.ai",
    indexerUrl: "https://indexer-storage-turbo.0g.ai",
    blockExplorerName: "0G Chainscan",
    blockExplorerUrl: "https://chainscan.0g.ai",
    nativeCurrency: {
      name: "OG",
      symbol: "OG",
      decimals: 18,
    },
    testnet: false,
  },
};

export function getZeroGConfig(chainId: number): ZeroGConfig {
  const config = ZERO_G_CONFIG_BY_CHAIN_ID[chainId as ZeroGChainId];
  if (!config) {
    throw new Error(
      "Connect your wallet to a 0G network before uploading feedback.",
    );
  }
  return config;
}

export function getZeroGChainIdFromNetwork(network: string): ZeroGChainId {
  return network.toLowerCase() === "0gmainnet" ? 16661 : 16602;
}

export function toChain(config: ZeroGConfig): Chain {
  return {
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: {
      default: {
        name: config.blockExplorerName,
        url: config.blockExplorerUrl,
      },
    },
    testnet: config.testnet,
  } as Chain;
}
