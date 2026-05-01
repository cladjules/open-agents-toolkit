/**
 * Shared types for the Open Agents Toolkit.
 * All blockchain types use viem's primitives for consistency and type safety.
 */

import type { Address, Hash, Hex } from "viem";

// ─── Wallet / Chain ──────────────────────────────────────────────────────────

/** Supported EVM chain IDs */
export type ChainId = number;

/** A wallet transaction request (EIP-1193 compatible subset) */
export interface TransactionRequest {
  readonly to: Address;
  readonly value?: bigint;
  readonly data?: Hex;
  readonly gasLimit?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
  readonly nonce?: number;
}

/** Result of a submitted transaction */
export interface TransactionResult {
  readonly hash: Hash;
}

/** Wallet connection state machine */
export type WalletConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; address: Address; chainId: ChainId }
  | { status: "error"; error: WalletError };

/** Wallet session stored in the encrypted local store */
export interface WalletSession {
  readonly connectionMethod: "eip6963" | "walletconnect";
  readonly address: Address;
  readonly chainId: ChainId;
  /** Opaque serialised session data (e.g. WalletConnect topic + keys) */
  readonly sessionData?: string;
  readonly connectedAt: number;
}

// ─── EIP-712 ─────────────────────────────────────────────────────────────────

export interface EIP712Domain {
  readonly name: string;
  readonly version: string;
  readonly chainId: ChainId;
  readonly verifyingContract?: Address;
  readonly salt?: Hex;
}

export interface EIP712TypeField {
  readonly name: string;
  readonly type: string;
}

export type EIP712Types = Record<string, readonly EIP712TypeField[]>;

export interface EIP712TypedData<T extends Record<string, unknown>> {
  readonly domain: EIP712Domain;
  readonly types: EIP712Types;
  readonly primaryType: string;
  readonly message: T;
}

// ─── Signed Requests (ERC-8128 / EIP-712) ────────────────────────────────────

/** The canonical signed request envelope */
export interface SignedRequest<TPayload = unknown> {
  readonly payload: TPayload;
  readonly chainId: ChainId;
  readonly agentAddress: Address;
  readonly timestamp: number;
  readonly nonce: string;
  readonly signature: Hex;
}

/** Result of a signature verification */
export type VerificationResult =
  | { valid: true; signerAddress: Address }
  | { valid: false; reason: string };

// ─── Agent Identity / Registry (ERC-8004) ────────────────────────────────────

/** ERC-8004 compliant service endpoint */
export interface AgentService {
  readonly name: string; // e.g., "web", "A2A", "MCP", "OASF", "ENS", "DID", "email"
  readonly endpoint: string; // URL, ENS name, DID, etc.
  readonly version?: string; // Protocol/service version
  readonly skills?: readonly string[]; // Optional: service-specific skills
  readonly domains?: readonly string[]; // Optional: service-specific domains
}

/** ERC-8004 compliant agent metadata / registration file */
export interface AgentRegistrationFile {
  readonly type: "agent";
  readonly specVersion: "1.0";
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly version?: string;
  readonly services: readonly AgentService[];
  readonly x402Support?: boolean;
  readonly active?: boolean;
  readonly supportedTrust?: readonly ("reputation" | "crypto-economic" | "tee-attestation")[];
  readonly wallet?: Address;
  readonly owner?: Address;
  /** IPFS CID or HTTP URL */
  readonly registrationFileUri?: string;
}

/** @deprecated Use AgentService instead. Kept for backward compatibility. */
export interface AgentEndpoint {
  readonly protocol: "http" | "https" | "ws" | "wss" | "grpc";
  readonly url: string;
  readonly description?: string;
  readonly authScheme?: "none" | "bearer" | "signed-request";
}

/** On-chain agent identity record */
export interface AgentIdentity {
  readonly agentId: bigint;
  readonly owner: Address;
  readonly agentWallet?: Address;
  readonly metadataUri: string;
  readonly registeredAt: number;
}

export interface FeedbackRecord {
  readonly client: Address;
  readonly agentId: bigint;
  readonly feedbackIndex: bigint;
  readonly value: bigint;
  readonly valueDecimals: number;
  readonly tag1: string;
  readonly tag2: string;
  readonly isRevoked: boolean;
}

/** Aggregated reputation summary returned by ReputationRegistry.getSummary */
export interface ReputationSummary {
  readonly count: bigint;
  readonly summaryValue: bigint;
  readonly summaryValueDecimals: number;
}

export interface ValidationRecord {
  readonly requestHash: `0x${string}`;
  readonly agentId: bigint;
  readonly validatorAddress: Address;
  readonly response: number;
  readonly responseHash: `0x${string}`;
  readonly tag: string;
  readonly lastUpdate: bigint;
}

/** Aggregated validation summary returned by ValidationRegistry.getSummary */
export interface ValidationSummary {
  readonly count: bigint;
  readonly averageResponse: number;
}

// ─── Agent NFT (ERC-7857) ─────────────────────────────────────────────────────

/** Plaintext agent metadata before encryption */
export interface AgentPrivateMetadata {
  readonly systemPrompt?: string;
  readonly intelligentData?: Record<string, unknown>;
}

/** Public metadata stored on-chain/IPFS */
export interface AgentNFTEncryptedData {
  readonly name: string;
  readonly uri: string;
  readonly hash: Hex;
}

export interface AgentNFTPublicMetadata {
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly agentType: string;
  readonly services?: readonly AgentService[];
  /** Named encrypted payloads for private intelligent data values. */
  readonly intelligentData?: readonly AgentNFTEncryptedData[];
  readonly createdAt: number;
}

/** On-chain NFT record */
export interface AgentNFTRecord {
  readonly tokenId: bigint;
  readonly owner: Address;
  readonly publicMetadataUri: string;
  readonly intelligentData: readonly Pick<AgentNFTEncryptedData, "name" | "hash">[];
  readonly verifierContract: Address;
  readonly mintedAt: number;
}

// ─── IPFS ─────────────────────────────────────────────────────────────────────

export interface IPFSUploadResult {
  readonly cid: string;
  readonly url: string;
  readonly size: number;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type WalletErrorCode =
  | "USER_REJECTED"
  | "CHAIN_UNSUPPORTED"
  | "NO_PROVIDER"
  | "PROVIDER_UNAVAILABLE"
  | "WALLET_NOT_CONNECTED"
  | "SIGN_ERROR"
  | "SEND_ERROR"
  | "SESSION_EXPIRED";

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  constructor(code: WalletErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WalletError";
    this.code = code;
  }
}

export type RegistryErrorCode =
  | "AGENT_NOT_FOUND"
  | "AGENT_ALREADY_REGISTERED"
  | "UNAUTHORIZED"
  | "STORAGE_ERROR"
  | "CONTRACT_ERROR"
  | "INVALID_METADATA";

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  constructor(code: RegistryErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RegistryError";
    this.code = code;
  }
}

export type NFTErrorCode =
  | "TOKEN_NOT_FOUND"
  | "NOT_OWNER"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "VERIFICATION_FAILED"
  | "STORAGE_ERROR";

export class NFTError extends Error {
  readonly code: NFTErrorCode;
  constructor(code: NFTErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NFTError";
    this.code = code;
  }
}
