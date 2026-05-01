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
  ChainId,
  EIP712Domain,
  EIP712TypeField,
  EIP712TypedData,
  EIP712Types,
  FeedbackRecord,
  IPFSUploadResult,
  NFTErrorCode,
  RegistryErrorCode,
  ReputationSummary,
  SignedRequest,
  TransactionRequest,
  TransactionResult,
  ValidationRecord,
  ValidationSummary,
  WalletConnectionState,
  WalletErrorCode,
  WalletSession,
  VerificationResult,
} from "./types.js";

// Error classes
export { NFTError, RegistryError, WalletError } from "./types.js";

// WalletAdapter interface
export type { ConnectOptions, SignTypedDataParams, WalletAdapter } from "./wallet-adapter.js";

// EIP-712 utilities
export {
  SIGNED_REQUEST_TYPE_NAME,
  SIGNED_REQUEST_TYPES,
  buildDomain,
  buildSignedRequestMessage,
  encodeDomainSeparator,
  generateNonce,
  hashPayload,
} from "./eip712.js";

// Session storage
export { clearAllSessions, deleteSession, loadSession, saveSession } from "./session-store.js";

// Network configuration
export { getNetworkConfig, resolveNetworkConfig, SUPPORTED_NETWORKS } from "./network.js";
export type { NetworkId, NetworkConfig } from "./network.js";
