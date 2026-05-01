/** Centralised env-var access for server actions. Never import on the client. */

import { defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";

const ZERO_G_NETWORKS = new Set(["0gTestnet", "0gMainnet"]);
export const zeroGTestnet = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "OG",
    symbol: "OG",
  },
  rpcUrls: {
    default: {
      http: ["https://evmrpc-testnet.0g.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "0G Galileo Chainscan",
      url: "https://chainscan-galileo.0g.ai",
    },
  },
  testnet: true,
});
export const zeroGMainnet = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "OG",
    symbol: "OG",
  },
  rpcUrls: {
    default: {
      http: ["https://evmrpc.0g.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "0G Chainscan",
      url: "https://chainscan.0g.ai",
    },
  },
  testnet: false,
});

export const NETWORKS = {
  sepolia,
  mainnet,
  "0gTestnet": zeroGTestnet,
  "0gMainnet": zeroGMainnet,
} as const;

export const cfg = {
  network: process.env.NEXT_PUBLIC_NETWORK ?? "0gTestnet",
  registryAddress: process.env.AGENT_REGISTRY_ADDRESS as `0x${string}` | undefined,
  ensRegistryAddress: process.env.ENS_AGENT_REGISTRY_ADDRESS as `0x${string}` | undefined,
  reputationAddress: process.env.REPUTATION_REGISTRY_ADDRESS as `0x${string}` | undefined,
  validationAddress: process.env.VALIDATION_REGISTRY_ADDRESS as `0x${string}` | undefined,
  teeVerifierAddress: process.env.NEXT_PUBLIC_TEE_VERIFIER_ADDRESS as `0x${string}` | undefined,
  rpcUrl: process.env.RPC_URL,
  deployerKey: process.env.PRIVATE_KEY as `0x${string}` | undefined,
  oracleKey: (process.env.ORACLE_PRIVATE_KEY as `0x${string}` | undefined) ?? (process.env.PRIVATE_KEY as `0x${string}` | undefined),
  zeroGKey: process.env.PRIVATE_KEY,
  get keyEncryptionPublicKey() {
    const configured = process.env.TEE_ENCRYPTION_PUBLIC_KEY as `0x${string}` | undefined;
    if (configured) return configured;
    return this.oracleKey ? (privateKeyToAccount(this.oracleKey).publicKey as `0x${string}`) : undefined;
  },
  get chain() {
    return NETWORKS[this.network as keyof typeof NETWORKS] ?? zeroGTestnet;
  },
  get chainId() {
    return this.chain.id;
  },
  get isConfigured() {
    return !!(this.ensRegistryAddress && this.rpcUrl && this.deployerKey);
  },
  get hasZeroG() {
    return !!(this.zeroGKey && ZERO_G_NETWORKS.has(this.network));
  },
};
