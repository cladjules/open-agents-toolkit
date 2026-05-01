/**
 * Encryption utilities for ERC-7857 private agent metadata.
 *
 * Strategy:
 *   - Content encryption: AES-256-GCM (symmetric, fast, authenticated)
 *   - Owner key management: ECDH shared-secret using the owner's Ethereum
 *     private key is NOT used directly (we never have it). Instead we store an
 *     ephemeral AES content key encrypted under the owner's public key via
 *     ECIES (Elliptic Curve Integrated Encryption Scheme).
 *
 * In the TEE transfer path the re-encryption happens inside the enclave;
 * this module handles the client-side decryption after the TEE verifier
 * confirms the transfer on-chain.
 *
 * Note: Web Crypto SubtleCrypto is used when available (browser / modern Node).
 * The Node.js `node:crypto` module is used as a fallback.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "eciesjs";
import { NFTError } from "@open-agents-toolkit/core";
import type {
  AgentNFTEncryptedData,
  AgentService,
} from "@open-agents-toolkit/core";
import type { Address, Hex } from "viem";
import { encodeAbiParameters, keccak256, toHex, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ZeroGReadOptions,
  readZeroGJSON,
  ZeroGStorageClient,
} from "./zero-g.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

export type ParsedServicesResult = {
  services?: AgentService[];
  error?: string;
};

export type ParseServicesOptions = {
  allowedServiceNames?: readonly string[];
};
export interface EncryptedBlob {
  /** Name of the encrypted metadata */
  name: string;
  /** Hex-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** Hex-encoded IV (12 bytes) */
  iv: string;
  /** Hex-encoded GCM auth tag (16 bytes) */
  authTag: string;
  /** Hex-encoded AES content key wrapped with ECIES */
  encryptedKey: string;
  /** Algorithm identifier */
  algorithm: "aes-256-gcm";
}

/**
 * Generate a fresh 32-byte AES content key.
 */
export function generateContentKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

function normalizeHexBytes(
  value: string | Uint8Array,
  label: string,
): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new NFTError(
      "ENCRYPTION_FAILED",
      `${label} must be a non-empty hex string.`,
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt an arbitrary JSON-serialisable payload with a given AES-256-GCM key.
 * Returns an EncryptedBlob ready for object storage.
 */
export function encryptMetadata(
  name: string,
  metadata: unknown,
  contentKey: Uint8Array,
  keyEncryptionPublicKey: string | Uint8Array,
): EncryptedBlob {
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, Buffer.from(contentKey), iv, {
      authTagLength: AUTH_TAG_LEN,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const recipientPublicKey = normalizeHexBytes(
      keyEncryptionPublicKey,
      "keyEncryptionPublicKey",
    );
    const wrappedKey = encrypt(recipientPublicKey, Buffer.from(contentKey));

    return {
      name,
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      encryptedKey: Buffer.from(wrappedKey).toString("hex"),
      algorithm: ALGORITHM,
    };
  } catch (err) {
    throw new NFTError(
      "ENCRYPTION_FAILED",
      `Metadata encryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Decrypt the wrapped AES content key using an ECIES private key.
 */
export function decryptContentKey(
  blob: Pick<EncryptedBlob, "encryptedKey">,
  keyEncryptionPrivateKey: string | Uint8Array,
): Uint8Array {
  try {
    const wrappedKey = normalizeHexBytes(
      blob.encryptedKey,
      "blob.encryptedKey",
    );
    const privateKey = normalizeHexBytes(
      keyEncryptionPrivateKey,
      "keyEncryptionPrivateKey",
    );
    return decrypt(privateKey, wrappedKey);
  } catch (err) {
    throw new NFTError(
      "DECRYPTION_FAILED",
      `Content key decryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Decrypt an EncryptedBlob back to its original JSON payload.
 * The caller must supply the content key (retrieved after ownership verification).
 */
export function decryptMetadata<T>(
  blob: EncryptedBlob,
  contentKey: Uint8Array,
): T {
  try {
    const iv = Buffer.from(blob.iv, "hex");
    const authTag = Buffer.from(blob.authTag, "hex");
    const ciphertext = Buffer.from(blob.ciphertext, "hex");

    const decipher = createDecipheriv(ALGORITHM, Buffer.from(contentKey), iv, {
      authTagLength: AUTH_TAG_LEN,
    });
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (err) {
    throw new NFTError(
      "DECRYPTION_FAILED",
      `Metadata decryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Compute the keccak256 hash of the serialised EncryptedBlob.
 * This hash is stored on-chain as the integrity anchor.
 */
export async function hashEncryptedBlob(
  blob: EncryptedBlob,
): Promise<`0x${string}`> {
  return keccak256(stringToHex(JSON.stringify(blob)));
}

export function parseAgentServicesJson(
  raw: string,
  options?: ParseServicesOptions,
): ParsedServicesResult {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { error: "Services must be a JSON array." };
    }

    if (
      parsed.some(
        (service) => !service?.name?.trim() || !service?.endpoint?.trim(),
      )
    ) {
      return { error: "Each service must have a name and endpoint." };
    }

    const services = parsed.map((service) => {
      const name = String(service.name).trim();
      const endpoint = String(service.endpoint).trim();
      const version = service.version
        ? String(service.version).trim()
        : undefined;

      return version
        ? ({ name, endpoint, version } as AgentService)
        : ({ name, endpoint } as AgentService);
    });

    if (options?.allowedServiceNames) {
      const allowed = new Set(options.allowedServiceNames);
      if (services.some((service) => !allowed.has(service.name))) {
        return {
          error:
            "Unsupported service name. Only EIP-8004 service names are allowed.",
        };
      }
    }

    return { services };
  } catch {
    return { error: "Services JSON is invalid." };
  }
}

export function buildAgentServiceTraits(services: readonly AgentService[]) {
  const traits: Array<{ trait_type: string; value: string }> = [
    { trait_type: "Services Count", value: String(services.length) },
  ];

  for (const service of services) {
    traits.push({
      trait_type: `Service: ${service.name}`,
      value: service.endpoint,
    });
    if (service.version) {
      traits.push({
        trait_type: `Service Version: ${service.name}`,
        value: service.version,
      });
    }
  }

  return traits;
}

export async function readJsonFromUri<T>(
  uri: string,
  options: ZeroGReadOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (uri.startsWith("zerog://")) {
    return readZeroGJSON<T>(uri, options);
  }

  const response = await fetchImpl(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${uri}: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getPrivateMetadataEntries(
  systemPrompt: string,
  characterDef: string,
) {
  const entries: Array<{ name: string; value: unknown }> = [];

  if (systemPrompt) {
    entries.push({ name: "systemPrompt", value: systemPrompt });
  }

  if (characterDef) {
    entries.push({ name: "characterDefinition", value: characterDef });
  }

  return entries;
}

export async function uploadEncryptedIntelligentData(params: {
  systemPrompt: string;
  characterDef: string;
  keyEncryptionPublicKey: Hex;
  zeroGPrivateKey: string;
  rpcUrl: string;
}): Promise<AgentNFTEncryptedData[]> {
  const {
    systemPrompt,
    characterDef,
    keyEncryptionPublicKey,
    zeroGPrivateKey,
    rpcUrl,
  } = params;
  const storage = new ZeroGStorageClient({
    privateKey: zeroGPrivateKey,
    rpcUrl,
  });
  const contentKey = generateContentKey();
  const intelligentData: AgentNFTEncryptedData[] = [];

  for (const entry of getPrivateMetadataEntries(systemPrompt, characterDef)) {
    const encryptedBlob = encryptMetadata(
      entry.name,
      entry.value,
      contentKey,
      keyEncryptionPublicKey,
    );
    const hash = await hashEncryptedBlob(encryptedBlob);
    const upload = await storage.uploadJSON(encryptedBlob);
    intelligentData.push({ name: entry.name, uri: upload.url, hash });
  }

  return intelligentData;
}

export type TransferAccessPayload = {
  oldDataHash: Hex;
  newDataHash: Hex;
  nonce: Hex;
  encryptedPubKey: Hex;
  digest: Hex;
};

export type TransferOwnershipProof = {
  oracleType: number;
  oldDataHash: Hex;
  newDataHash: Hex;
  sealedKey: Hex;
  encryptedPubKey: Hex;
  nonce: Hex;
  proof: Hex;
};

export type SecureTransferPayloads = {
  newDataHashes: Hex[];
  sealedKey: Hex;
  accessPayloads: TransferAccessPayload[];
  ownershipProofs: TransferOwnershipProof[];
};

export async function buildSecureTransferPayloads(params: {
  tokenId: bigint;
  to: Address;
  currentHashes: Hex[];
  oraclePrivateKey: Hex;
  now?: () => number;
}): Promise<SecureTransferPayloads> {
  const { tokenId, to, currentHashes, oraclePrivateKey } = params;
  const now = params.now ?? (() => Date.now());
  const oracleAccount = privateKeyToAccount(oraclePrivateKey);

  const newDataHashes = [...currentHashes];
  const accessPayloads: TransferAccessPayload[] = [];
  const ownershipProofs: TransferOwnershipProof[] = [];
  let sealedKey = "0x" as Hex;

  for (let index = 0; index < currentHashes.length; index += 1) {
    const oldDataHash = currentHashes[index] as Hex;
    const newDataHash = newDataHashes[index] as Hex;
    const encryptedPubKey = encodeAbiParameters([{ type: "address" }], [to]);
    const timestamp = now();
    const accessNonce = toHex(
      `access:${tokenId.toString()}:${index}:${timestamp}`,
    );
    const ownershipNonce = toHex(
      `ownership:${tokenId.toString()}:${index}:${timestamp}`,
    );

    const generatedSealedKey = keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "address" },
          { type: "uint256" },
        ],
        [tokenId, oldDataHash, newDataHash, to, BigInt(index)],
      ),
    );

    const accessInnerHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes" },
          { type: "bytes" },
        ],
        [oldDataHash, newDataHash, encryptedPubKey, accessNonce],
      ),
    );

    const ownershipInnerHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes" },
          { type: "bytes" },
          { type: "bytes" },
        ],
        [
          oldDataHash,
          newDataHash,
          generatedSealedKey,
          encryptedPubKey,
          ownershipNonce,
        ],
      ),
    );

    const ownershipSignature = await oracleAccount.signMessage({
      message: { raw: Buffer.from(ownershipInnerHash.slice(2), "hex") },
    });

    accessPayloads.push({
      oldDataHash,
      newDataHash,
      nonce: accessNonce,
      encryptedPubKey,
      digest: accessInnerHash,
    });

    ownershipProofs.push({
      oracleType: 0,
      oldDataHash,
      newDataHash,
      sealedKey: generatedSealedKey,
      encryptedPubKey,
      nonce: ownershipNonce,
      proof: ownershipSignature,
    });

    if (index === 0) {
      sealedKey = generatedSealedKey;
    }
  }

  return { newDataHashes, sealedKey, accessPayloads, ownershipProofs };
}

export function buildDecryptMessage(
  agentId: string,
  ownerAddress: string,
  signedAt: number,
) {
  return `Open Agents Toolkit decrypt request\nagentId:${agentId}\nowner:${ownerAddress.toLowerCase()}\nsignedAt:${signedAt}`;
}

export function decryptEncryptedBlob(
  blob: Record<string, unknown>,
  oraclePrivateKey: Hex,
): unknown {
  const encryptedKey =
    typeof blob.encryptedKey === "string" ? blob.encryptedKey : "";
  const ciphertext = typeof blob.ciphertext === "string" ? blob.ciphertext : "";
  const iv = typeof blob.iv === "string" ? blob.iv : "";
  const authTag = typeof blob.authTag === "string" ? blob.authTag : "";
  const name = typeof blob.name === "string" ? blob.name : "";

  if (!encryptedKey || !ciphertext || !iv || !authTag) {
    throw new Error("Encrypted blob format is invalid.");
  }

  const contentKey = decryptContentKey({ encryptedKey }, oraclePrivateKey);
  return decryptMetadata(
    {
      name,
      encryptedKey,
      ciphertext,
      iv,
      authTag,
      algorithm: "aes-256-gcm",
    },
    contentKey,
  );
}
