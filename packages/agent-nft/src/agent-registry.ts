/**
 * AgentRegistry — Read-only TypeScript client for the ERC-8004 on-chain registry.
 *
 * Combines AgentRegistry, ReputationRegistry, and ValidationRegistry queries.
 * Frontend owns all write operations via direct viem contract calls.
 */

import { AgentIdentity, AgentRegistrationFile, RegistryError } from "@open-agents-toolkit/core";
import { Address, Hex } from "viem";
import { PublicClient } from "viem";
import { AGENT_REGISTRY_ABI, REPUTATION_REGISTRY_ABI, VALIDATION_REGISTRY_ABI } from "./abis.js";
import { readZeroGJSON, ZeroGReadOptions } from "./zero-g.js";
import createDebug from "debug";

const log = createDebug("oat:registry");
const logRead = createDebug("oat:registry:read");
const logReputation = createDebug("oat:registry:reputation");
const logValidation = createDebug("oat:registry:validation");

export interface AgentRegistryConfig {
  agentRegistryAddress: Address;
  reputationRegistryAddress: Address;
  validationRegistryAddress: Address;
  publicClient: PublicClient;
  zeroG?: ZeroGReadOptions;
}

// ─── ERC-8004 result types ────────────────────────────────────────────────────

export interface FeedbackEntry {
  client: Address;
  feedbackIndex: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  isRevoked: boolean;
}

export interface ReputationSummary {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
}

export interface ValidationStatus {
  validatorAddress: Address;
  agentId: bigint;
  response: number;
  responseHash: Hex;
  tag: string;
  lastUpdate: bigint;
}

export interface ValidationSummary {
  count: bigint;
  averageResponse: number;
}

export class AgentRegistry {
  private readonly _cfg: AgentRegistryConfig;

  constructor(config: AgentRegistryConfig) {
    this._cfg = config;
    log(
      "initialised agentRegistry=%s reputationRegistry=%s validationRegistry=%s",
      config.agentRegistryAddress,
      config.reputationRegistryAddress,
      config.validationRegistryAddress,
    );
  }

  // ─── Read Operations ──────────────────────────────────────────────────────

  /**
   * Resolve an agent's on-chain identity and fetch metadata from its URI.
   */
  async resolve(agentId: bigint): Promise<AgentIdentity & { metadata: AgentRegistrationFile }> {
    logRead("resolve agentId=%s", agentId.toString());
    const [owner, agentWallet, metadataUri] = await Promise.all([
      this._cfg.publicClient.readContract({
        address: this._cfg.agentRegistryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [agentId],
      }),
      this._cfg.publicClient.readContract({
        address: this._cfg.agentRegistryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getAgentWallet",
        args: [agentId],
      }),
      this._cfg.publicClient.readContract({
        address: this._cfg.agentRegistryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getMetadataUri",
        args: [agentId],
      }),
    ]);

    let metadata: AgentRegistrationFile;
    if (metadataUri.startsWith("zerog://")) {
      metadata = await readZeroGJSON<AgentRegistrationFile>(metadataUri, this._cfg.zeroG);
    } else {
      const res = await fetch(metadataUri);
      if (!res.ok) {
        throw new RegistryError(
          "AGENT_NOT_FOUND",
          `Failed to fetch metadata from ${metadataUri}: ${res.status}`,
        );
      }
      metadata = (await res.json()) as AgentRegistrationFile;
    }

    logRead("resolved agentId=%s owner=%s name=%s", agentId.toString(), owner, metadata.name);

    return {
      agentId,
      owner: owner as Address,
      agentWallet: agentWallet as Address,
      metadataUri,
      registeredAt: 0, // Block timestamp not indexed in the minimal ABI
      metadata,
    };
  }

  /**
   * Fetch all feedback entries for an agent.
   *
   * @param agentId         Target agent token ID.
   * @param clientAddresses Optional filter — if empty, returns feedback from all clients.
   * @param tag1            Optional tag filter.
   * @param tag2            Optional secondary tag filter.
   * @param includeRevoked  Include revoked feedback entries (default false).
   */
  async getFeedback(
    agentId: bigint,
    clientAddresses: Address[] = [],
    tag1 = "",
    tag2 = "",
    includeRevoked = false,
  ): Promise<FeedbackEntry[]> {
    logReputation(
      "getFeedback agentId=%s clients=%d tag1=%s tag2=%s includeRevoked=%s",
      agentId.toString(),
      clientAddresses.length,
      tag1,
      tag2,
      includeRevoked,
    );
    const raw = await this._cfg.publicClient.readContract({
      address: this._cfg.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "readAllFeedback",
      args: [agentId, clientAddresses, tag1, tag2, includeRevoked],
    });

    const [clients, feedbackIndexes, values, valueDecimalsList, tag1s, tag2s, revokedStatuses] =
      raw as [Address[], bigint[], bigint[], number[], string[], string[], boolean[]];

    const entries = clients.map((client, i) => ({
      client,
      feedbackIndex: feedbackIndexes[i]!,
      value: values[i]!,
      valueDecimals: valueDecimalsList[i]!,
      tag1: tag1s[i]!,
      tag2: tag2s[i]!,
      isRevoked: revokedStatuses[i]!,
    }));
    logReputation("getFeedback agentId=%s returned %d entries", agentId.toString(), entries.length);
    return entries;
  }

  /**
   * Get aggregated reputation statistics for an agent.
   *
   * @param agentId         Target agent token ID.
   * @param clientAddresses Non-empty list of clients to include (Sybil protection).
   * @param tag1            Optional tag filter.
   * @param tag2            Optional secondary tag filter.
   */
  async getReputationSummary(
    agentId: bigint,
    clientAddresses: Address[],
    tag1 = "",
    tag2 = "",
  ): Promise<ReputationSummary> {
    logReputation(
      "getReputationSummary agentId=%s clients=%d tag1=%s tag2=%s",
      agentId.toString(),
      clientAddresses.length,
      tag1,
      tag2,
    );
    const [count, summaryValue, summaryValueDecimals] = (await this._cfg.publicClient.readContract({
      address: this._cfg.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, clientAddresses, tag1, tag2],
    })) as [bigint, bigint, number];

    logReputation(
      "getReputationSummary agentId=%s count=%s summaryValue=%s",
      agentId.toString(),
      count.toString(),
      summaryValue.toString(),
    );
    return { count, summaryValue, summaryValueDecimals };
  }

  /**
   * Get the validation status for a specific request hash.
   */
  async getValidationStatus(requestHash: Hex): Promise<ValidationStatus> {
    logValidation("getValidationStatus requestHash=%s", requestHash);
    const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
      (await this._cfg.publicClient.readContract({
        address: this._cfg.validationRegistryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: "getValidationStatus",
        args: [requestHash],
      })) as [Address, bigint, number, Hex, string, bigint];

    logValidation(
      "getValidationStatus requestHash=%s agentId=%s response=%d",
      requestHash,
      agentId.toString(),
      response,
    );
    return { validatorAddress, agentId, response, responseHash, tag, lastUpdate };
  }

  /**
   * Get aggregated validation statistics for an agent.
   *
   * @param agentId            Target agent token ID.
   * @param validatorAddresses Optional filter by validator.
   * @param tag                Optional tag filter.
   */
  async getValidationSummary(
    agentId: bigint,
    validatorAddresses: Address[] = [],
    tag = "",
  ): Promise<ValidationSummary> {
    const [count, averageResponse] = (await this._cfg.publicClient.readContract({
      address: this._cfg.validationRegistryAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, validatorAddresses, tag],
    })) as [bigint, number];

    return { count, averageResponse };
  }

  /**
   * Get all request hashes associated with an agent.
   */
  async getAgentValidations(agentId: bigint): Promise<Hex[]> {
    const hashes = await this._cfg.publicClient.readContract({
      address: this._cfg.validationRegistryAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getAgentValidations",
      args: [agentId],
    });
    return hashes as Hex[];
  }

  /**
   * Get the list of unique clients who have given feedback to an agent.
   */
  async getClients(agentId: bigint): Promise<Address[]> {
    const clients = await this._cfg.publicClient.readContract({
      address: this._cfg.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    });
    return clients as Address[];
  }
}
