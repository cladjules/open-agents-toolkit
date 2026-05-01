"use server";

import { createPublicClient, http, namehash } from "viem";
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent-nft/browser";
import {
  buildAgentServiceTraits,
  buildSecureTransferPayloads,
  parseAgentServicesJson,
  readJsonFromUri,
  ZeroGStorageClient,
  uploadEncryptedIntelligentData,
} from "@open-agents-toolkit/agent-nft";
import { cfg } from "@/lib/config";

type PublicMetadataDocument = {
  name: string;
  description: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PreparedCreateAgentResult = {
  contractAddress?: `0x${string}`;
  agentRegistry?: string;
  node?: `0x${string}`;
  publicMetadataUri?: string;
  agentMetadataUri?: string;
  mintFee?: string;
  intelligentData?: Array<{ dataDescription: string; dataHash: `0x${string}` }>;
  error?: string;
};

type PreparedTransferAgentResult = {
  contractAddress?: `0x${string}`;
  tokenId?: string;
  to?: `0x${string}`;
  newDataHashes?: `0x${string}`[];
  sealedKey?: `0x${string}`;
  accessPayloads?: Array<{
    oldDataHash: `0x${string}`;
    newDataHash: `0x${string}`;
    nonce: `0x${string}`;
    encryptedPubKey: `0x${string}`;
    digest: `0x${string}`;
  }>;
  ownershipProofs?: Array<{
    oracleType: number;
    oldDataHash: `0x${string}`;
    newDataHash: `0x${string}`;
    sealedKey: `0x${string}`;
    encryptedPubKey: `0x${string}`;
    nonce: `0x${string}`;
    proof: `0x${string}`;
  }>;
  error?: string;
};

type PreparedUpdateServicesResult = {
  contractAddress?: `0x${string}`;
  tokenId?: string;
  tokenUri?: string;
  error?: string;
};

async function makePublicClient() {
  return createPublicClient({
    chain: cfg.chain as any,
    transport: http(cfg.rpcUrl!),
  });
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Transfer an Agent NFT through secureTransfer.
 *
 * This action is recipient-only by design: all secure transfer payloads are
 * derived server-side from current on-chain intelligent-data hashes.
 */
export async function prepareTransferAgent(
  formData: FormData,
): Promise<PreparedTransferAgentResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const to = (formData.get("to") as string | null)?.trim() as
    | `0x${string}`
    | undefined;

  if (!tokenId) return { error: "Token ID is required." };
  if (!to) return { error: "Recipient address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const publicClient = await makePublicClient();
    const numericTokenId = BigInt(tokenId);

    const [intelligentDatas] = await Promise.all([
      publicClient.readContract({
        address: cfg.registryAddress!,
        abi: AGENT_REGISTRY_ABI,
        functionName: "intelligentDataOf",
        args: [numericTokenId],
      }),
    ]);

    const currentHashes = (
      intelligentDatas as ReadonlyArray<{ dataHash: `0x${string}` }>
    ).map((item) => item.dataHash);

    const newDataHashes = currentHashes;

    let accessPayloads: PreparedTransferAgentResult["accessPayloads"] = [];
    let ownershipProofs: PreparedTransferAgentResult["ownershipProofs"] = [];
    let sealedKey = "0x" as `0x${string}`;

    if (currentHashes.length > 0) {
      const oracleKey = cfg.oracleKey;
      if (!oracleKey) {
        return {
          error:
            "ORACLE_PRIVATE_KEY (or PRIVATE_KEY fallback) is required for automatic verifier proof generation.",
        };
      }

      const payloads = await buildSecureTransferPayloads({
        tokenId: numericTokenId,
        to,
        currentHashes,
        oraclePrivateKey: oracleKey,
      });

      accessPayloads = payloads.accessPayloads;
      ownershipProofs = payloads.ownershipProofs;
      sealedKey = payloads.sealedKey;
    }

    return {
      contractAddress: cfg.registryAddress!,
      tokenId,
      to,
      newDataHashes,
      sealedKey,
      accessPayloads,
      ownershipProofs,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Transfer preparation failed.",
    };
  }
}

/**
 * Prepare a tokenURI update so the connected wallet can submit the on-chain write.
 */
export async function prepareUpdateAgentServices(
  formData: FormData,
): Promise<PreparedUpdateServicesResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const servicesJson =
    (formData.get("servicesJson") as string | null)?.trim() ?? "[]";

  if (!tokenId) return { error: "Token ID is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };
  if (!cfg.zeroGKey)
    return { error: "0G storage is required. Configure PRIVATE_KEY." };

  const { services, error } = parseAgentServicesJson(servicesJson);
  if (error) return { error };

  try {
    const publicClient = await makePublicClient();
    const numericTokenId = BigInt(tokenId);

    const publicMetadataUri = await publicClient.readContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [numericTokenId],
    });

    const publicMetadata = await readJsonFromUri<PublicMetadataDocument>(
      publicMetadataUri,
      { rpcUrl: cfg.rpcUrl! },
    );

    const preservedAttributes = (publicMetadata.attributes ?? []).filter(
      (attribute) => {
        const traitType = attribute?.trait_type ?? "";
        return (
          traitType !== "Services Count" && !traitType.startsWith("Service:")
        );
      },
    );

    const updatedPublicMetadata: PublicMetadataDocument = {
      ...publicMetadata,
      attributes: [
        ...preservedAttributes,
        ...buildAgentServiceTraits(services ?? []),
      ],
    };

    const storage = new ZeroGStorageClient({
      privateKey: cfg.zeroGKey,
      rpcUrl: cfg.rpcUrl!,
    });
    const publicUpload = await storage.uploadJSON(updatedPublicMetadata);
    return {
      contractAddress: cfg.registryAddress!,
      tokenId,
      tokenUri: publicUpload.url,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Updating services failed.",
    };
  }
}

// ─── Unified Create ───────────────────────────────────────────────────────────

export async function prepareCreateAgent(
  formData: FormData,
): Promise<PreparedCreateAgentResult | { tokenId: bigint }> {
  const logPrefix = "[prepareCreateAgent]";
  console.log(`${logPrefix} start`);

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const imageUrl = (formData.get("imageUrl") as string | null)?.trim();
  const agentType =
    (formData.get("agentType") as string | null)?.trim() ?? "assistant";
  const systemPrompt =
    (formData.get("systemPrompt") as string | null)?.trim() ?? "";
  const characterDef =
    (formData.get("characterDef") as string | null)?.trim() ?? "";
  const servicesJson =
    (formData.get("servicesJson") as string | null)?.trim() ?? "[]";
  const ownerAddress = (
    formData.get("ownerAddress") as string | null
  )?.trim() as `0x${string}` | undefined;
  const ensName = (formData.get("ensName") as string | null)?.trim();
  const keyEncryptionPublicKey = cfg.keyEncryptionPublicKey;

  console.log(`${logPrefix} form values extracted`, {
    hasName: Boolean(name),
    hasDescription: Boolean(description),
    hasImageUrl: Boolean(imageUrl),
    agentType,
    hasSystemPrompt: Boolean(systemPrompt),
    hasCharacterDef: Boolean(characterDef),
    hasServicesJson: Boolean(servicesJson),
    hasOwnerAddress: Boolean(ownerAddress),
    ensName,
    hasKeyEncryptionPublicKey: Boolean(keyEncryptionPublicKey),
  });

  if (!name) {
    console.warn(`${logPrefix} validation failed: missing name`);
    return { error: "Agent name is required." };
  }
  if (!description) {
    console.warn(`${logPrefix} validation failed: missing description`);
    return { error: "Description is required." };
  }
  if (!ensName) {
    console.warn(`${logPrefix} validation failed: missing ensName`);
    return { error: "ENS name is required." };
  }

  if (!keyEncryptionPublicKey) {
    console.warn(`${logPrefix} config missing: keyEncryptionPublicKey`);
    return {
      error:
        "TEE key encryption public key not configured (TEE_ENCRYPTION_PUBLIC_KEY).",
    };
  }

  if (!cfg.zeroGKey) {
    console.warn(`${logPrefix} config missing: zeroGKey`);
    return { error: "0G storage is required. Configure PRIVATE_KEY." };
  }

  if (!ownerAddress) {
    console.warn(`${logPrefix} validation failed: missing ownerAddress`);
    return { error: "Connect your wallet before creating an agent." };
  }

  let services: Array<{ name: string; endpoint: string; version?: string }> =
    [];
  if (servicesJson) {
    console.log(`${logPrefix} parsing services JSON`);
    const parsedServices = parseAgentServicesJson(servicesJson, {
      allowedServiceNames: ["web", "A2A", "MCP", "OASF", "DID", "email", "ENS"],
    });
    if (parsedServices.error) {
      console.warn(`${logPrefix} services parse failed`, {
        error: parsedServices.error,
      });
      return { error: parsedServices.error };
    }
    services = parsedServices.services ?? [];
    console.log(`${logPrefix} services parsed`, {
      serviceCount: services.length,
      serviceNames: services.map((service) => service.name),
    });
  }

  // ENS service must always be present and reflect the selected ENS name.
  services = [
    ...services.filter((service) => service.name !== "ENS"),
    { name: "ENS", endpoint: ensName, version: "v1" },
  ];
  console.log(`${logPrefix} services normalized with ENS`, {
    serviceCount: services.length,
  });

  if (!cfg.isConfigured) {
    const fallbackTokenId = BigInt(Math.floor(Math.random() * 9000) + 1000);
    console.warn(
      `${logPrefix} contracts not configured; returning fallback token`,
      {
        fallbackTokenId: fallbackTokenId.toString(),
      },
    );
    return { tokenId: fallbackTokenId };
  }

  try {
    console.log(`${logPrefix} creating public client`);
    const publicClient = await makePublicClient();

    // Read mint fee and predict the next agentId (_nextTokenId == totalSupply).
    console.log(`${logPrefix} reading mint fee and predicted agent ID`);
    const [mintFee, predictedAgentId] = await Promise.all([
      publicClient.readContract({
        address: cfg.registryAddress!,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getMintFee",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: cfg.registryAddress!,
        abi: AGENT_REGISTRY_ABI,
        functionName: "totalSupply",
      }) as Promise<bigint>,
    ]);

    console.log(`${logPrefix} chain reads complete`, {
      mintFee: mintFee.toString(),
      predictedAgentId: predictedAgentId.toString(),
      registryAddress: cfg.registryAddress,
      ensRegistryAddress: cfg.ensRegistryAddress,
      chainId: cfg.chainId,
    });

    const agentRegistry = `eip155:${cfg.chainId}:${cfg.registryAddress}`;
    console.log(`${logPrefix} agent registry ref built`, { agentRegistry });

    console.log(`${logPrefix} uploading encrypted intelligent data`);
    const intelligentData = await uploadEncryptedIntelligentData({
      systemPrompt,
      characterDef,
      keyEncryptionPublicKey,
      zeroGPrivateKey: cfg.zeroGKey!,
      rpcUrl: cfg.rpcUrl!,
    });
    console.log(`${logPrefix} encrypted intelligent data uploaded`, {
      itemCount: intelligentData.length,
      hashes: intelligentData.map((item) => item.hash),
    });

    const publicMetadata = {
      name,
      description,
      image: imageUrl || undefined,
      agentType,
      services,
      createdAt: Date.now(),
    };
    console.log(`${logPrefix} public metadata prepared`, {
      hasImage: Boolean(publicMetadata.image),
      serviceCount: services.length,
    });

    console.log(`${logPrefix} initializing 0G storage client`);
    const storage = new ZeroGStorageClient({
      privateKey: cfg.zeroGKey,
      rpcUrl: cfg.rpcUrl!,
    });

    console.log(`${logPrefix} uploading public metadata`);
    const publicUpload = await storage.uploadJSON(publicMetadata);

    console.log(`${logPrefix} uploading agent metadata`);
    const agentUpload = await storage.uploadJSON({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name,
      description,
      image: imageUrl || undefined,
      services,
      active: true,
      registrations: [
        {
          agentId: Number(predictedAgentId),
          agentRegistry: agentRegistry,
        },
      ],
      supportedTrust: ["tee-attestation"],
      wallet: ownerAddress,
      owner: ownerAddress,
    });

    console.log(`${logPrefix} metadata uploads complete`, {
      publicMetadataUri: publicUpload.url,
      agentMetadataUri: agentUpload.url,
    });

    console.log(`${logPrefix} success`);

    return {
      contractAddress: cfg.ensRegistryAddress!,
      agentRegistry: `${agentRegistry}/${predictedAgentId}`,
      node: namehash(ensName) as `0x${string}`,
      publicMetadataUri: publicUpload.url,
      agentMetadataUri: agentUpload.url,
      mintFee: mintFee.toString(),
      intelligentData: intelligentData.map((item) => ({
        dataDescription: item.uri,
        dataHash: item.hash,
      })),
    };
  } catch (err) {
    console.error(`${logPrefix} failed`, err);
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}
