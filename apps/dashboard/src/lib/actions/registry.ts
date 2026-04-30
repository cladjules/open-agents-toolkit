"use server";

import type { AgentIdentity, AgentRegistrationFile } from "@open-agents-toolkit/core";
import { ZeroGStorageClient } from "@open-agents-toolkit/agent-nft";
import { cfg } from "@/lib/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegisteredAgent = AgentIdentity & { metadata: AgentRegistrationFile };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeRegistry() {
  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { AgentRegistry } = await import("@open-agents-toolkit/agent-nft");

  const account = privateKeyToAccount(cfg.deployerKey!);
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl!) });
  const walletClient = createWalletClient({
    account,
    chain: cfg.chain,
    transport: http(cfg.rpcUrl!),
  });

  const registry = new AgentRegistry({
    agentRegistryAddress: cfg.registryAddress!,
    reputationRegistryAddress: cfg.reputationAddress ?? cfg.registryAddress!,
    validationRegistryAddress: cfg.validationAddress ?? cfg.registryAddress!,
    publicClient ,
      walletClient ,
  });

  return { registry, account, publicClient };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getRegisteredAgents(): Promise<RegisteredAgent[]> {
  if (!cfg.registryAddress || !cfg.rpcUrl) return [];

  try {
    const { createPublicClient, http, parseAbiItem } = await import("viem");
    const { AgentRegistry } = await import("@open-agents-toolkit/agent-nft");

    const publicClient = createPublicClient({ chain: cfg.chain, transport: http(process.env.RPC_URL_LOG || cfg.rpcUrl) });

    const registry = new AgentRegistry({
      agentRegistryAddress: cfg.registryAddress,
      reputationRegistryAddress: cfg.reputationAddress ?? cfg.registryAddress,
      validationRegistryAddress: cfg.validationAddress ?? cfg.registryAddress,
      publicClient ,
    });


    const logs = await publicClient.getLogs({
      address: cfg.registryAddress,
      event: parseAbiItem(
        "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
      ),
      fromBlock: "earliest",
      toBlock: "latest",
    });


    const agents = await Promise.allSettled(
      logs.map((log) => registry.resolve(log.args.agentId as bigint)),
    );
    return agents
      .filter((r): r is PromiseFulfilledResult<RegisteredAgent> => r.status === "fulfilled")
      .map((r) => r.value)
      .reverse();
      
  } catch (e) {
    console.log(e)
    return [];
  }
}

export async function getAgent(id: bigint): Promise<RegisteredAgent | null> {
  if (!cfg.registryAddress || !cfg.rpcUrl) return null;

  try {
    const { createPublicClient, http } = await import("viem");
    const { AgentRegistry } = await import("@open-agents-toolkit/agent-nft");

    const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });

    const registry = new AgentRegistry({
      agentRegistryAddress: cfg.registryAddress,
      reputationRegistryAddress: cfg.reputationAddress ?? cfg.registryAddress,
      validationRegistryAddress: cfg.validationAddress ?? cfg.registryAddress,
      publicClient ,
    });

    return await registry.resolve(id);
  } catch {
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function giveFeedback(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const agentId = (formData.get("agentId") as string | null)?.trim();
  const valueStr = (formData.get("value") as string | null)?.trim();
  const tag1 = (formData.get("tag1") as string | null)?.trim() ?? "";
  const tag2 = (formData.get("tag2") as string | null)?.trim() ?? "";
  const feedbackJson = (formData.get("feedbackJson") as string | null)?.trim() ?? "";
  const feedbackFile = formData.get("feedbackFile");

  if (!agentId) return { error: "Agent ID is required." };
  if (!valueStr) return { error: "Feedback value is required." };

  const valueNum = parseFloat(valueStr);
  if (isNaN(valueNum) || valueNum < -1 || valueNum > 1) {
    return { error: "Feedback value must be between -1 and 1." };
  }

  if (!cfg.zeroGKey) {
    return { error: "0G storage is required for feedback. Configure PRIVATE_KEY." };
  }

  let uploadedFeedback: unknown;
  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    try {
      const fileText = await feedbackFile.text();
      uploadedFeedback = JSON.parse(fileText);
    } catch {
      return { error: "Feedback file must contain valid JSON." };
    }
  } else if (feedbackJson) {
    try {
      uploadedFeedback = JSON.parse(feedbackJson);
    } catch {
      return { error: "Feedback JSON is invalid." };
    }
  } else {
    return { error: "Provide feedback JSON text or upload a .json file." };
  }

  let feedbackURI = "";
  try {
    const storage = new ZeroGStorageClient({ privateKey: cfg.zeroGKey, rpcUrl: cfg.rpcUrl! });
    const payload = {
      agentId,
      value: valueNum,
      tags: [tag1, tag2].filter(Boolean),
      createdAt: new Date().toISOString(),
      feedback: uploadedFeedback,
    };
    const upload = await storage.uploadJSON(payload);
    feedbackURI = upload.url;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Uploading feedback JSON to 0G failed." };
  }

  if (!cfg.isConfigured) return { txHash: "0xsimulated" };

  try {
    const { registry } = await makeRegistry();
    const decimals = 4;
    const value = BigInt(Math.round(valueNum * Math.pow(10, decimals)));
    await registry.giveFeedback(BigInt(agentId), { value, valueDecimals: decimals, tag1, tag2, feedbackURI });
    return { txHash: "submitted" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Feedback failed." };
  }
}

export async function requestValidation(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const agentId = (formData.get("agentId") as string | null)?.trim();
  const validatorAddress = (formData.get("validatorAddress") as string | null)?.trim() as `0x${string}` | undefined;
  const requestURI = (formData.get("requestURI") as string | null)?.trim() ?? "";

  if (!agentId) return { error: "Agent ID is required." };
  if (!validatorAddress) return { error: "Validator address is required." };

  if (!cfg.isConfigured || !cfg.validationAddress) return { txHash: "0xsimulated" };

  try {
    const { keccak256, toHex } = await import("viem");
    const { registry } = await makeRegistry();

    const requestHash = keccak256(toHex(`${agentId}:${validatorAddress}:${requestURI}:${Date.now()}`));
    await registry.requestValidation(validatorAddress, BigInt(agentId), requestURI, requestHash);
    return { txHash: "submitted" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Validation request failed." };
  }
}



