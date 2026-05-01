"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { encodeAbiParameters, toBytes } from "viem";
import type { AgentService } from "@open-agents-toolkit/core";
import {
  AGENT_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@open-agents-toolkit/agent-nft/browser";
import { useWallet } from "@/components/wallet/WalletProvider";
import { prepareTransferAgent, prepareUpdateAgentServices } from "@/lib/actions/agents";
import { prepareValidation } from "@/lib/actions/registry";
import { uploadJsonWithConnectedWallet } from "@/lib/zero-g-browser";

interface Props {
  agentId: string;
  registryAddress?: `0x${string}`;
  reputationAddress?: `0x${string}`;
  owner: string;
  initialServices: readonly AgentService[];
}

export default function AgentDetailActions({ agentId, registryAddress, reputationAddress, owner, initialServices }: Props) {
  const { address } = useWallet();
  const [moreOpen, setMoreOpen] = useState(false);
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isOwner ? (
          <>
            <ActionCard title="Edit Services" description="Update the ERC-8004 service list and refresh the ERC-721 service traits.">
              <ServiceEditorForm agentId={agentId} initialServices={initialServices} />
            </ActionCard>

            <ActionCard title="Model Allowance" description="Grant another wallet approval to operate this model NFT.">
              <AuthorizeUsageForm tokenId={agentId} registryAddress={registryAddress} />
            </ActionCard>

            <ActionCard title="Transfer" description="Move ownership to a new address.">
              <TransferForm tokenId={agentId} />
            </ActionCard>
          </>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 text-sm text-gray-400 md:col-span-2">
            {address
              ? "Owner-only edit, approval, and transfer controls are hidden for wallets that do not own this agent."
              : "Connect the owner wallet to edit services, manage allowances, or transfer this agent."}
          </div>
        )}

        <ActionCard title="Give Feedback" description="Submit ERC-8004 reputation feedback.">
          <FeedbackForm agentId={agentId} reputationAddress={reputationAddress} />
        </ActionCard>
      </div>

      <div className="border border-gray-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-900/50 transition-colors cursor-pointer"
        >
          <span>More actions</span>
          <span className="text-gray-600">{moreOpen ? "▲" : "▼"}</span>
        </button>

        {moreOpen && (
          <div className="border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            {isOwner && (
              <SmallActionCard title="Revoke Model Allowance">
                <RevokeAuthForm tokenId={agentId} registryAddress={registryAddress} />
              </SmallActionCard>
            )}
            <SmallActionCard title="Request Validation">
              <ValidationForm agentId={agentId} />
            </SmallActionCard>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function ActionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-gray-500 text-sm">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SmallActionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-lg border border-gray-800 bg-gray-900/30 space-y-3">
      <h4 className="text-sm font-semibold text-gray-300">{title}</h4>
      {children}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function useActionState() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ txHash?: string; tokenId?: bigint; error?: string } | null>(null);

  function run(fn: () => Promise<{ txHash?: string; tokenId?: bigint; error?: string }>) {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  }

  return { isPending, result, run };
}

function ResultBanner({ result }: { result: { txHash?: string; tokenId?: bigint; error?: string } | null }) {
  if (!result) return null;
  if (result.error)
    return <p className="text-xs text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">{result.error}</p>;
  return (
    <p className="text-xs text-green-400 bg-green-950/40 px-3 py-2 rounded-lg">
      ✓{" "}
      {result.tokenId !== undefined
        ? `Token ID: #${result.tokenId.toString()}`
        : result.txHash
        ? `Tx: ${result.txHash.slice(0, 18)}…`
        : "Success"}
    </p>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
      />
    </div>
  );
}

function SubmitButton({ isPending, label }: { isPending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
    >
      {isPending ? "Submitting…" : label}
    </button>
  );
}

function validateJsonInput(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch {
    return "Invalid JSON.";
  }
}

function parseFeedbackValue(valueStr: string | null) {
  if (!valueStr?.trim()) {
    return { error: "Feedback value is required." };
  }

  const valueNum = parseFloat(valueStr);
  if (Number.isNaN(valueNum) || valueNum < -1 || valueNum > 1) {
    return { error: "Feedback value must be between -1 and 1." };
  }

  const valueDecimals = 4;
  const value = BigInt(Math.round(valueNum * Math.pow(10, valueDecimals)));
  return { value, valueDecimals, valueNum };
}

async function readFeedbackPayload(formData: FormData) {
  const feedbackJson = (formData.get("feedbackJson") as string | null)?.trim() ?? "";
  const feedbackFile = formData.get("feedbackFile");

  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    try {
      return JSON.parse(await feedbackFile.text()) as unknown;
    } catch {
      throw new Error("Feedback file must contain valid JSON.");
    }
  }

  if (feedbackJson) {
    try {
      return JSON.parse(feedbackJson) as unknown;
    } catch {
      throw new Error("Feedback JSON is invalid.");
    }
  }

  throw new Error("Provide feedback JSON text or upload a .json file.");
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function FeedbackForm({
  agentId,
  reputationAddress,
}: {
  agentId: string;
  reputationAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { chainId, getEip1193Provider, getViemClients } = useWallet();
  const [feedbackJson, setFeedbackJson] = useState('{\n  "summary": "Great response quality",\n  "details": { "latencyMs": 820 }\n}');
  const feedbackJsonError = validateJsonInput(feedbackJson);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!reputationAddress) return { error: "Reputation registry is not configured." };

          const formData = new FormData(e.currentTarget);
          const parsedValue = parseFeedbackValue((formData.get("value") as string | null) ?? null);
          if ("error" in parsedValue) return { error: parsedValue.error };

          let uploadedFeedback: unknown;
          try {
            uploadedFeedback = await readFeedbackPayload(formData);
          } catch (error) {
            return { error: error instanceof Error ? error.message : "Feedback JSON is invalid." };
          }

          if (!chainId) return { error: "Connect your wallet before submitting feedback." };

          const tag1 = (formData.get("tag1") as string | null)?.trim() ?? "";
          const tag2 = (formData.get("tag2") as string | null)?.trim() ?? "";
          const provider = await getEip1193Provider();
          const upload = await uploadJsonWithConnectedWallet(
            {
              agentId,
              value: parsedValue.valueNum,
              tags: [tag1, tag2].filter(Boolean),
              createdAt: new Date().toISOString(),
              feedback: uploadedFeedback,
            },
            chainId,
            provider,
          );

          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: reputationAddress,
            abi: REPUTATION_REGISTRY_ABI,
            functionName: "giveFeedback",
            args: [
              BigInt(agentId),
              parsedValue.value,
              parsedValue.valueDecimals,
              tag1,
              tag2,
              "",
              upload.url,
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="agentId" value={agentId} />
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Value * <span className="text-gray-600">(-1.0 to 1.0)</span>
        </label>
        <input
          name="value"
          type="number"
          min="-1"
          max="1"
          step="0.01"
          placeholder="0.8"
          required
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tag 1" name="tag1" placeholder="helpful" />
        <Field label="Tag 2" name="tag2" placeholder="fast" />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Feedback JSON</label>
        <textarea
          name="feedbackJson"
          value={feedbackJson}
          onChange={(e) => setFeedbackJson(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 font-mono placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
        />
        {feedbackJsonError ? (
          <p className="text-xs text-red-400 mt-1">{feedbackJsonError}</p>
        ) : (
          <p className="text-xs text-green-400 mt-1">Valid JSON.</p>
        )}
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Or Upload JSON File</label>
        <input
          name="feedbackFile"
          type="file"
          accept="application/json,.json"
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-violet-600 file:text-white file:text-xs"
        />
      </div>
      <p className="text-xs text-gray-600">We upload this JSON to 0G and submit the resulting URI on-chain.</p>
      <SubmitButton isPending={isPending} label="Submit Feedback" />
      <ResultBanner result={result} />
    </form>
  );
}

function TransferForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const prepared = await prepareTransferAgent(new FormData(e.currentTarget));
          if (prepared.error) return { error: prepared.error };

          const { publicClient, walletClient } = await getViemClients();
          const accessPayloads = prepared.accessPayloads ?? [];
          const ownershipProofs = prepared.ownershipProofs ?? [];
          const transferProofs = await Promise.all(
            accessPayloads.map(async (payload, index) => ({
              accessProof: {
                oldDataHash: payload.oldDataHash,
                newDataHash: payload.newDataHash,
                nonce: payload.nonce,
                encryptedPubKey: payload.encryptedPubKey,
                proof: await walletClient.signMessage({
                  account: walletClient.account!,
                  message: { raw: toBytes(payload.digest) },
                }),
              },
              ownershipProof: ownershipProofs[index],
            })),
          );

          const proof = encodeAbiParameters(
            [
              {
                type: "tuple[]",
                components: [
                  {
                    name: "accessProof",
                    type: "tuple",
                    components: [
                      { name: "oldDataHash", type: "bytes32" },
                      { name: "newDataHash", type: "bytes32" },
                      { name: "nonce", type: "bytes" },
                      { name: "encryptedPubKey", type: "bytes" },
                      { name: "proof", type: "bytes" },
                    ],
                  },
                  {
                    name: "ownershipProof",
                    type: "tuple",
                    components: [
                      { name: "oracleType", type: "uint8" },
                      { name: "oldDataHash", type: "bytes32" },
                      { name: "newDataHash", type: "bytes32" },
                      { name: "sealedKey", type: "bytes" },
                      { name: "encryptedPubKey", type: "bytes" },
                      { name: "nonce", type: "bytes" },
                      { name: "proof", type: "bytes" },
                    ],
                  },
                ],
              },
            ],
            [transferProofs],
          );

          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "secureTransfer",
            args: [
              BigInt(prepared.tokenId!),
              prepared.to!,
              prepared.newDataHashes ?? [],
              prepared.sealedKey ?? "0x",
              proof,
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Recipient Address *" name="to" placeholder="0x…" required />
      <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-400">
        Standard transfer only needs recipient address. If this token uses a verifier, transfer proof data is
        generated automatically on the server.
      </div>
      <SubmitButton isPending={isPending} label="Transfer" />
      <ResultBanner result={result} />
    </form>
  );
}

function ServiceEditorForm({
  agentId,
  initialServices,
}: {
  agentId: string;
  initialServices: readonly AgentService[];
}) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients } = useWallet();
  const [services, setServices] = useState<Array<{ name: string; endpoint: string; version?: string }>>(
    initialServices.length > 0
      ? initialServices.map((service) => ({
          name: service.name,
          endpoint: service.endpoint,
          version: service.version ?? "",
        }))
      : [{ name: "", endpoint: "", version: "" }],
  );

  function addService() {
    setServices((current) => [...current, { name: "", endpoint: "", version: "" }]);
  }

  function removeService(index: number) {
    setServices((current) => current.filter((_, idx) => idx !== index));
  }

  function updateService(index: number, field: "name" | "endpoint" | "version", value: string) {
    setServices((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.set("tokenId", agentId);
        formData.set("servicesJson", JSON.stringify(services));
        run(async () => {
          const prepared = await prepareUpdateAgentServices(formData);
          if (prepared.error) return { error: prepared.error };

          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: AGENT_REGISTRY_ABI,
            functionName: "setTokenURI",
            args: [BigInt(prepared.tokenId!), prepared.tokenUri!],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      {services.map((service, index) => (
        <div key={`${index}:${service.name}:${service.endpoint}`} className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Service Name *</label>
              <input
                value={service.name}
                onChange={(e) => updateService(index, "name", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
                placeholder="chat-completions"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Version</label>
              <input
                value={service.version ?? ""}
                onChange={(e) => updateService(index, "version", e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
                placeholder="v1"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Endpoint *</label>
            <input
              value={service.endpoint}
              onChange={(e) => updateService(index, "endpoint", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
              placeholder="https://example.com/v1/chat/completions"
              required
            />
          </div>
          {services.length > 1 && (
            <button
              type="button"
              onClick={() => removeService(index)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Remove Service
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addService}
        className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm font-semibold transition-colors"
      >
        + Add Service
      </button>

      <SubmitButton isPending={isPending} label="Save Services" />
      <ResultBanner result={result} />
    </form>
  );
}

function AuthorizeUsageForm({
  tokenId,
  registryAddress,
}: {
  tokenId: string;
  registryAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const { getViemClients } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!registryAddress) return { error: "Agent registry is not configured." };
          const formData = new FormData(e.currentTarget);
          const user = (formData.get("user") as string | null)?.trim() as `0x${string}` | undefined;
          if (!user) return { error: "User address is required." };

          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: registryAddress,
            abi: AGENT_REGISTRY_ABI,
            functionName: "approve",
            args: [user, BigInt(tokenId)],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Wallet Address *" name="user" placeholder="0x…" required />
      <p className="text-xs text-gray-600">This grants ERC-721 token approval for this specific model NFT.</p>
      <SubmitButton isPending={isPending} label="Grant Allowance" />
      <ResultBanner result={result} />
    </form>
  );
}

function RevokeAuthForm({
  tokenId,
  registryAddress,
}: {
  tokenId: string;
  registryAddress?: `0x${string}`;
}) {
  const { isPending, result, run } = useActionState();
  const { getViemClients } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (!registryAddress) return { error: "Agent registry is not configured." };
          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: registryAddress,
            abi: AGENT_REGISTRY_ABI,
            functionName: "approve",
            args: ["0x0000000000000000000000000000000000000000", BigInt(tokenId)],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <p className="text-xs text-gray-600">This clears the current token-level approval via approve(0x0, tokenId).</p>
      <SubmitButton isPending={isPending} label="Revoke Allowance" />
      <ResultBanner result={result} />
    </form>
  );
}

function ValidationForm({ agentId }: { agentId: string }) {
  const { isPending, result, run } = useActionState();
  const router = useRouter();
  const { getViemClients } = useWallet();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const prepared = await prepareValidation(new FormData(e.currentTarget));
          if (prepared.error) return { error: prepared.error };

          const { publicClient, walletClient } = await getViemClients();
          const hash = await walletClient.writeContract({
            address: prepared.contractAddress!,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: "validationRequest",
            args: [
              prepared.validatorAddress!,
              BigInt(prepared.agentId!),
              prepared.requestURI ?? "",
              prepared.requestHash!,
            ],
            chain: walletClient.chain,
            account: walletClient.account!,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          router.refresh();
          return { txHash: hash };
        });
      }}
      className="space-y-3"
    >
      <input type="hidden" name="agentId" value={agentId} />
      <Field label="Validator Address *" name="validatorAddress" placeholder="0x…" required />
      <Field label="Request URI" name="requestURI" placeholder="https://…" />
      <SubmitButton isPending={isPending} label="Request" />
      <ResultBanner result={result} />
    </form>
  );
}

