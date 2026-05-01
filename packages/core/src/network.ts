/**
 * Network configuration for the Open Agents Toolkit.
 *
 * Set the NETWORK env var to one of: sepolia | mainnet | 0gTestnet | 0gMainnet
 * Optionally override the RPC endpoint with RPC_URL.
 *
 * Use resolveNetworkConfig() in application code (reads env vars).
 * Use getNetworkConfig(id) in library code (pure, no env reads).
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NetworkId = "sepolia" | "mainnet" | "0gTestnet" | "0gMainnet";

export interface NetworkConfig {
  id: NetworkId;
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /**
   * Effective RPC URL.
   * In configs returned by getNetworkConfig() this is the public default.
   * resolveNetworkConfig() overrides it with RPC_URL if set.
   */
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
  /** 0G-specific config — only present for 0G networks */
  zeroG?: {
    /** Turbo storage indexer URL */
    storageIndexerUrl: string;
    storageExplorerUrl: string;
    faucetUrl?: string;
    /** 0G Compute Network marketplace URL */
    computeMarketplaceUrl: string;
  };
}

// ─── Static network configs ────────────────────────────────────────────────────

const NETWORK_CONFIGS: Record<NetworkId, NetworkConfig> = {
  sepolia: {
    id: "sepolia",
    chainId: 11155111,
    name: "Sepolia",
    rpcUrl: "https://rpc.sepolia.org",
    explorerUrl: "https://sepolia.etherscan.io",
    isTestnet: true,
  },
  mainnet: {
    id: "mainnet",
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    isTestnet: false,
  },
  "0gTestnet": {
    id: "0gTestnet",
    chainId: 16602,
    name: "0G Galileo Testnet",
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    explorerUrl: "https://chainscan-galileo.0g.ai",
    isTestnet: true,
    zeroG: {
      storageIndexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
      storageExplorerUrl: "https://storagescan-galileo.0g.ai",
      faucetUrl: "https://faucet.0g.ai",
      computeMarketplaceUrl: "https://compute-marketplace.0g.ai",
    },
  },
  "0gMainnet": {
    id: "0gMainnet",
    chainId: 16661,
    name: "0G Mainnet",
    rpcUrl: "https://evmrpc.0g.ai",
    explorerUrl: "https://chainscan.0g.ai",
    isTestnet: false,
    zeroG: {
      storageIndexerUrl: "https://indexer-storage-turbo.0g.ai",
      storageExplorerUrl: "https://storagescan.0g.ai",
      computeMarketplaceUrl: "https://compute-marketplace.0g.ai",
    },
  },
};

// ─── API ───────────────────────────────────────────────────────────────────────

/**
 * Get the static network config for a known network ID.
 * Pure function — does not read env vars.
 */
export function getNetworkConfig(id: NetworkId): NetworkConfig {
  return NETWORK_CONFIGS[id];
}

/**
 * Resolve network config from env vars:
 *   NETWORK  — one of: sepolia | mainnet | 0gTestnet | 0gMainnet (default: sepolia)
 *   RPC_URL  — optional override for the default public RPC endpoint
 *
 * Call once at application startup and pass the result down to all clients.
 */
export function resolveNetworkConfig(): NetworkConfig {
  const rawNetwork = process.env["NEXT_PUBLIC_NETWORK"] ?? "sepolia";

  if (!(rawNetwork in NETWORK_CONFIGS)) {
    throw new Error(
      `Unknown NETWORK="${rawNetwork}". Valid values: sepolia, mainnet, 0gTestnet, 0gMainnet`,
    );
  }

  const base = NETWORK_CONFIGS[rawNetwork as NetworkId];
  const rpcUrlOverride = process.env["RPC_URL"];

  return rpcUrlOverride ? { ...base, rpcUrl: rpcUrlOverride } : base;
}

export const SUPPORTED_NETWORKS = Object.keys(NETWORK_CONFIGS) as NetworkId[];
