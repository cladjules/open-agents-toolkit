/**
 * AgentNFT — TypeScript client for reading ERC-7857 AI Agent NFTs with private metadata.
 *
 * Write operations (mint, transfer, updateMetadata) are handled via contract calls
 * and server-side helpers in encryption.ts.
 *
 * This client focuses on:
 *   1. loadMetadata()  — fetch encrypted items → decrypt and rebuild metadata
 *   2. getRecord()     — read on-chain metadata and hashes
 */

import type { Address, Hex, PublicClient } from "viem";
import { NFTError } from "@open-agents-toolkit/core";
import type {
  AgentNFTRecord,
  AgentPrivateMetadata,
} from "@open-agents-toolkit/core";
import { decryptMetadata, hashEncryptedBlob } from "./encryption.js";
import type { EncryptedBlob } from "./encryption.js";
import { AGENT_REGISTRY_ABI } from "./abis.js";

const createDebug =
  (namespace: string) =>
  (...args: unknown[]) =>
    console.log(`[${namespace}]`, ...args);

const log = createDebug("oat:agent-nft");
const logMetadata = createDebug("oat:agent-nft:metadata");

interface OnChainIntelligentData {
  dataDescription: string;
  dataHash: Hex;
}

interface PrivateMetadataEntry {
  name: string;
  value: unknown;
}

export interface AgentNFTConfig {
  contractAddress: Address;
  publicClient: PublicClient;
}

export class AgentNFTClient {
  private readonly _cfg: AgentNFTConfig;
  private readonly _keyStore: Map<bigint, Uint8Array> = new Map();

  constructor(config: AgentNFTConfig) {
    this._cfg = config;
    log("initialised contractAddress=%s", config.contractAddress);
  }

  /**
   * Load and decrypt private metadata for a token.
   * Requires provideContentKey() to be called first with the content key.
   */
  async loadMetadata(tokenId: bigint): Promise<AgentPrivateMetadata> {
    logMetadata("loadMetadata tokenId=%s", tokenId.toString());

    const contentKey = this._keyStore.get(tokenId);
    if (!contentKey) {
      throw new NFTError(
        "DECRYPTION_FAILED",
        `No content key found for token ${tokenId}. Call provideContentKey() first.`,
      );
    }

    const [publicMetadataUri, onChainIntelligentData] = await Promise.all([
      this._cfg.publicClient.readContract({
        address: this._cfg.contractAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [tokenId],
      }),
      this._cfg.publicClient.readContract({
        address: this._cfg.contractAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "intelligentDataOf",
        args: [tokenId],
      }),
    ]);

    const pubMetaRes = await fetch(publicMetadataUri as string);
    if (!pubMetaRes.ok) {
      throw new NFTError(
        "STORAGE_ERROR",
        `Failed to fetch public metadata: ${pubMetaRes.status}`,
      );
    }
    const pubMeta = (await pubMetaRes.json()) as any;
    const publicItems = pubMeta.intelligentData ?? [];
    const onChainItems = onChainIntelligentData as OnChainIntelligentData[];

    if (publicItems.length !== onChainItems.length) {
      throw new NFTError(
        "VERIFICATION_FAILED",
        "Public metadata and on-chain intelligent data are out of sync.",
      );
    }

    const onChainHashes = new Map(
      onChainItems.map((item) => [item.dataDescription, item.dataHash]),
    );
    const decryptedEntries: PrivateMetadataEntry[] = [];

    for (const item of publicItems) {
      const onChainHash = onChainHashes.get(item.name);
      if (!onChainHash) {
        throw new NFTError(
          "VERIFICATION_FAILED",
          `Missing on-chain intelligent data for ${item.name}.`,
        );
      }
      if (onChainHash !== item.hash) {
        throw new NFTError(
          "VERIFICATION_FAILED",
          `Hash mismatch for intelligent data item ${item.name}.`,
        );
      }

      const blobRes = await fetch(item.uri);
      if (!blobRes.ok) {
        throw new NFTError(
          "STORAGE_ERROR",
          `Failed to fetch encrypted blob for ${item.name}: ${blobRes.status}`,
        );
      }
      const blob = (await blobRes.json()) as EncryptedBlob;
      const computedHash = await hashEncryptedBlob(blob);
      if (computedHash !== item.hash) {
        throw new NFTError(
          "VERIFICATION_FAILED",
          `Encrypted blob hash mismatch for ${item.name}.`,
        );
      }

      decryptedEntries.push({
        name: item.name,
        value: decryptMetadata<unknown>(blob, contentKey),
      });
    }

    return this._rebuildPrivateMetadata(decryptedEntries);
  }

  /**
   * Get on-chain metadata and crypto hashes without decryption.
   */
  async getRecord(tokenId: bigint): Promise<AgentNFTRecord> {
    logMetadata("getRecord tokenId=%s", tokenId.toString());
    const [owner, publicMetadataUri, intelligentData, verifierContract] =
      await Promise.all([
        this._cfg.publicClient.readContract({
          address: this._cfg.contractAddress,
          abi: AGENT_REGISTRY_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        }),
        this._cfg.publicClient.readContract({
          address: this._cfg.contractAddress,
          abi: AGENT_REGISTRY_ABI,
          functionName: "tokenURI",
          args: [tokenId],
        }),
        this._cfg.publicClient.readContract({
          address: this._cfg.contractAddress,
          abi: AGENT_REGISTRY_ABI,
          functionName: "intelligentDataOf",
          args: [tokenId],
        }),
        this._cfg.publicClient.readContract({
          address: this._cfg.contractAddress,
          abi: AGENT_REGISTRY_ABI,
          functionName: "verifier",
          args: [],
        }),
      ]);

    return {
      tokenId,
      owner: owner as Address,
      publicMetadataUri: publicMetadataUri as string,
      intelligentData: (intelligentData as OnChainIntelligentData[]).map(
        (item) => ({
          name: item.dataDescription,
          hash: item.dataHash,
        }),
      ),
      verifierContract: verifierContract as Address,
      mintedAt: 0,
    };
  }

  /**
   * Provide the AES content key for a token to enable decryption.
   * Typically called after secure transfer.
   */
  provideContentKey(tokenId: bigint, contentKey: Uint8Array): void {
    this._keyStore.set(tokenId, contentKey);
    log("content key provided for tokenId=%s", tokenId.toString());
  }

  private _rebuildPrivateMetadata(
    entries: readonly PrivateMetadataEntry[],
  ): AgentPrivateMetadata {
    let systemPrompt: string | undefined;
    const intelligentData: Record<string, unknown> = {};

    for (const entry of entries) {
      if (entry.name === "systemPrompt") {
        systemPrompt =
          typeof entry.value === "string" ? entry.value : String(entry.value);
        continue;
      }
      intelligentData[entry.name] = entry.value;
    }

    return {
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(Object.keys(intelligentData).length > 0 ? { intelligentData } : {}),
    };
  }
}
