/**
 * @open-agents-toolkit/agent-nft
 *
 * ERC-7857 AI Agent NFTs with private encrypted metadata.
 */

export { AgentNFTClient } from "./agent-nft.js";
export type { AgentNFTConfig } from "./agent-nft.js";

export { AgentRegistry } from "./agent-registry.js";
export type {
  AgentRegistryConfig,
  FeedbackEntry,
  ReputationSummary,
  ValidationStatus,
  ValidationSummary,
} from "./agent-registry.js";

export { ZeroGStorageClient } from "./zero-g.js";
export { readZeroGBytes, readZeroGJSON } from "./zero-g.js";
export type { ZeroGStorageOptions, ZeroGReadOptions } from "./zero-g.js";

export {
  encryptMetadata,
  decryptMetadata,
  decryptContentKey,
  generateContentKey,
  hashEncryptedBlob,
  EncryptedBlob,
  buildAgentServiceTraits,
  buildDecryptMessage,
  buildSecureTransferPayloads,
  decryptEncryptedBlob,
  getPrivateMetadataEntries,
  parseAgentServicesJson,
  readJsonFromUri,
  uploadEncryptedIntelligentData,
  ParseServicesOptions,
  ParsedServicesResult,
  SecureTransferPayloads,
  TransferAccessPayload,
  TransferOwnershipProof,
} from "./encryption.js";

export {
  AGENT_REGISTRY_ABI,
  AGENT_NFT_ABI,
  REPUTATION_REGISTRY_ABI,
  TEE_VERIFIER_ABI,
  VALIDATION_REGISTRY_ABI,
  ENS_AGENT_REGISTRY_ABI,
} from "./abis.js";
