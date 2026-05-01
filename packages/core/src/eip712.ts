/**
 * EIP-712 utilities.
 *
 * Provides the canonical domain separator, type hash helpers, and the
 * EIP-712 struct used by the signed-requests package.
 */

import { encodeAbiParameters, keccak256, stringToHex, toBytes } from "viem";
import type { Address, Hex } from "viem";
import type { ChainId, EIP712Domain } from "./types.js";

// ─── Domain ──────────────────────────────────────────────────────────────────

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const SIGNED_REQUEST_TYPE_NAME = "SignedAgentRequest";

/** The EIP-712 types for the SignedRequest envelope */
export const SIGNED_REQUEST_TYPES = {
  [SIGNED_REQUEST_TYPE_NAME]: [
    { name: "payloadHash", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "agentAddress", type: "address" },
    { name: "timestamp", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Build the EIP-712 domain object for a given chain and optional verifying contract.
 */
export function buildDomain(chainId: ChainId, verifyingContract?: Address): EIP712Domain {
  const domain: EIP712Domain = {
    name: "OpenAgentsToolkit",
    version: "1",
    chainId,
  };
  if (verifyingContract !== undefined) {
    return { ...domain, verifyingContract };
  }
  return domain;
}

/**
 * Hash a JSON-serialisable payload to a bytes32.
 * Uses keccak256(utf8(JSON.stringify(payload))).
 */
export function hashPayload(payload: unknown): Hex {
  const json = JSON.stringify(payload, sortedReplacer);
  return keccak256(stringToHex(json));
}

/**
 * Generate a cryptographically-random 32-byte nonce as a hex string.
 */
export function generateNonce(): Hex {
  const bytes = new Uint8Array(32);
  // globalThis.crypto is available in browsers and Node.js ≥ 19.
  // For Node.js 18 (which also ships with Web Crypto), this still works.
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Convert a Uint8Array to a 0x-prefixed hex string */
function bytesToHex(bytes: Uint8Array): Hex {
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/** JSON replacer that sorts keys for deterministic hashing */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}

/**
 * Build the EIP-712 message for a SignedAgentRequest.
 */
export function buildSignedRequestMessage(params: {
  payload: unknown;
  chainId: ChainId;
  agentAddress: Address;
  timestamp: number;
  nonce: Hex;
}): {
  payloadHash: Hex;
  chainId: bigint;
  agentAddress: Address;
  timestamp: bigint;
  nonce: Hex;
} {
  return {
    payloadHash: hashPayload(params.payload),
    chainId: BigInt(params.chainId),
    agentAddress: params.agentAddress,
    timestamp: BigInt(params.timestamp),
    nonce: params.nonce,
  };
}

/**
 * Encode EIP-712 domain parameters for on-chain use.
 * Returns the ABI encoded domain separator bytes.
 */
export function encodeDomainSeparator(domain: EIP712Domain): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, // domainTypeHash
        { type: "bytes32" }, // name
        { type: "bytes32" }, // version
        { type: "uint256" }, // chainId
        { type: "address" }, // verifyingContract
      ],
      [
        keccak256(
          stringToHex(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
          ),
        ),
        keccak256(stringToHex(domain.name)),
        keccak256(stringToHex(domain.version)),
        BigInt(domain.chainId),
        domain.verifyingContract ?? ("0x0000000000000000000000000000000000000000" as Address),
      ],
    ),
  );
}

// Re-export toBytes for use in other packages
export { toBytes };
