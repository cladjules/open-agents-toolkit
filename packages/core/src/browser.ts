/**
 * Browser-safe entry point for @open-agents-toolkit/core.
 * Excludes session-store (which uses Node.js fs/path/os).
 */

// Types
export type {
  AgentEndpoint,
  AgentIdentity,
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
  SignedRequest,
  TransactionRequest,
  TransactionResult,
  ValidationRecord,
  ValidationSummary,
  ReputationSummary,
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
