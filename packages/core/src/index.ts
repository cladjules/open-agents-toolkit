/**
 * @open-agents-toolkit/core
 *
 * Core types, WalletAdapter interface, EIP-712 utilities, and session storage.
 * This package is a dependency of all other packages in the monorepo.
 */

// Types
export type {
  AgentEndpoint,
  AgentIdentity,
  AgentNFTEncryptedData,
  AgentNFTPublicMetadata,
  AgentNFTRecord,
  AgentPrivateMetadata,
  AgentRegistrationFile,
  AgentService,
  FeedbackRecord,
  IPFSUploadResult,
  NFTErrorCode,
  RegistryErrorCode,
  ReputationSummary,
  ValidationRecord,
  ValidationSummary,
} from "./types.js";

// Error classes
export { NFTError, RegistryError } from "./types.js";

// Network configuration
export {
  getNetworkConfig,
  resolveNetworkConfig,
  SUPPORTED_NETWORKS,
} from "./network.js";
export type { NetworkId, NetworkConfig } from "./network.js";
