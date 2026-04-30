"use server";

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AGENT_REGISTRY_ABI, AgentNFTClient } from "@open-agents-toolkit/agent-nft";
import { cfg } from "@/lib/config";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeClients() {
  const account = privateKeyToAccount(cfg.deployerKey!);
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl!) });
  const walletClient = createWalletClient({
    account,
    chain: cfg.chain,
    transport: http(cfg.rpcUrl!),
  });

  return { publicClient, walletClient, account, AGENT_REGISTRY_ABI };
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Transfer an Agent NFT (ERC-721 safeTransferFrom).
 */
export async function transferAgent(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const to = (formData.get("to") as string | null)?.trim() as `0x${string}` | undefined;

  if (!tokenId) return { error: "Token ID is required." };
  if (!to) return { error: "Recipient address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const { publicClient, walletClient, account, AGENT_REGISTRY_ABI } = await makeClients();

    const hash = await walletClient.writeContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "safeTransferFrom",
      args: [account.address, to, BigInt(tokenId)],
      chain: cfg.chain,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Transfer failed." };
  }
}

/**
 * Approve an address for a specific Agent NFT (ERC-721 approve).
 */
export async function approveAgent(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const spender = (formData.get("spender") as string | null)?.trim() as `0x${string}` | undefined;

  if (!tokenId) return { error: "Token ID is required." };
  if (!spender) return { error: "Spender address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const { publicClient, walletClient, account, AGENT_REGISTRY_ABI } = await makeClients();

    const hash = await walletClient.writeContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "approve",
      args: [spender, BigInt(tokenId)],
      chain: cfg.chain,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Approve failed." };
  }
}

/**
 * Authorize an address to operate a specific token via ERC-721 approve().
 */
export async function authorizeUsage(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const user = (formData.get("user") as string | null)?.trim() as `0x${string}` | undefined;

  if (!tokenId) return { error: "Token ID is required." };
  if (!user) return { error: "User address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const { publicClient, walletClient, account, AGENT_REGISTRY_ABI } = await makeClients();

    const hash = await walletClient.writeContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "approve",
      args: [user, BigInt(tokenId)],
      chain: cfg.chain,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Authorize failed." };
  }
}

/**
 * Revoke token-level approval via ERC-721 approve(0x0, tokenId).
 */
export async function revokeAuthorization(
  formData: FormData,
): Promise<{ txHash?: string; error?: string }> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();

  if (!tokenId) return { error: "Token ID is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const { publicClient, walletClient, account, AGENT_REGISTRY_ABI } = await makeClients();

    const hash = await walletClient.writeContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "approve",
      args: ["0x0000000000000000000000000000000000000000", BigInt(tokenId)],
      chain: cfg.chain,
      account,
    });

    await publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Revoke failed." };
  }
}

// ─── Unified Create ───────────────────────────────────────────────────────────

export async function createAgent(
  formData: FormData,
): Promise<{ tokenId?: bigint; txHash?: string; error?: string }> {
  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const imageUrl = (formData.get("imageUrl") as string | null)?.trim();
  const agentType = (formData.get("agentType") as string | null)?.trim() ?? "assistant";
  const systemPrompt = (formData.get("systemPrompt") as string | null)?.trim() ?? "";
  const characterDef = (formData.get("characterDef") as string | null)?.trim() ?? "";
  const servicesJson = (formData.get("servicesJson") as string | null)?.trim() ?? "[]";
  const teeVerifier = cfg.teeVerifierAddress;

  if (!name) return { error: "Agent name is required." };
  if (!description) return { error: "Description is required." };

  if (!teeVerifier) {
    return { error: "TEE Verifier not configured (NEXT_PUBLIC_TEE_VERIFIER_ADDRESS)." };
  }

  if (!cfg.zeroGKey) {
    return { error: "0G storage is required. Configure PRIVATE_KEY." };
  }

  let services: Array<{ name: string; endpoint: string; version?: string }> = [];
  if (servicesJson) {
    try {
      const parsed = JSON.parse(servicesJson);
      if (!Array.isArray(parsed)) {
        return { error: "Services must be a JSON array." };
      }
      if (parsed.length === 0) {
        return { error: "At least one service is required." };
      }
      if (parsed.some((s) => !s.name?.trim() || !s.endpoint?.trim())) {
        return { error: "Each service must have a name and endpoint." };
      }
      services = parsed;
    } catch {
      return { error: "Services JSON is invalid." };
    }
  }

  // Demo mode — contracts not configured
  if (!cfg.isConfigured) {
    return { tokenId: BigInt(Math.floor(Math.random() * 9000) + 1000) };
  }

  try {
    const account = privateKeyToAccount(cfg.deployerKey!);
    const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl!) });
    const walletClient = createWalletClient({
      account,
      chain: cfg.chain,
      transport: http(cfg.rpcUrl!),
    });

    // Unified flow: mint() also performs ERC-8004 registration on-chain.
    const client = new AgentNFTClient({
      contractAddress: cfg.registryAddress!,
      publicClient: publicClient as any,
      walletClient: walletClient as any,
      defaultVerifierAddress: teeVerifier,
      zeroG: { privateKey: cfg.zeroGKey, rpcUrl: cfg.rpcUrl! },
    });

    const res = await client.mint({
      publicMetadata: {
        name,
        description,
        agentType,
        image: imageUrl || undefined,
        services,
      },
      privateMetadata: {
        systemPrompt,
        characterDefinition: characterDef,
      },
      verifierAddress: teeVerifier,
    });

    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Create failed." };
  }
}


