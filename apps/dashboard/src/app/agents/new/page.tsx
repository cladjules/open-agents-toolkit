"use client";

import { useState, useTransition } from "react";
import { createAgent } from "@/lib/actions/agents";

const AGENT_TYPES = [
  { value: "assistant", label: "Assistant" },
  { value: "researcher", label: "Researcher" },
  { value: "coder", label: "Coder" },
  { value: "analyst", label: "Analyst" },
  { value: "creative", label: "Creative" },
  { value: "other", label: "Other" },
];

const PROTOCOLS = ["https", "http", "wss", "ws", "grpc"];

interface AgentService {
  name: string;
  endpoint: string;
  version?: string;
}

export default function NewAgentPage() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tokenId?: bigint; txHash?: string; error?: string } | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [services, setServices] = useState<AgentService[]>([
    { name: "default", endpoint: "", version: "" },
  ]);

  function addService() {
    setServices([...services, { name: "", endpoint: "", version: "" }]);
  }

  function removeService(index: number) {
    setServices(services.filter((_, i) => i !== index));
  }

  function updateService(index: number, field: keyof AgentService, value: string) {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);

    const formData = new FormData(e.currentTarget);
    // Add services as JSON
    formData.set("servicesJson", JSON.stringify(services));

    startTransition(async () => {
      const r = await createAgent(formData);
      setResult(r);
    });
  }

  if (result?.tokenId !== undefined && !result.error) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-4">
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-bold text-green-400">Agent Created!</h2>
        <p className="text-gray-400">
          Token ID:{" "}
          <span className="font-mono text-white font-semibold">#{result.tokenId.toString()}</span>
        </p>
        {result.txHash && (
          <p className="font-mono text-xs text-gray-500 break-all">{result.txHash}</p>
        )}
        <div className="flex gap-3 justify-center pt-2">
          <a
            href={`/agents/${result.tokenId.toString()}`}
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold"
          >
            View Agent
          </a>
          <button
            onClick={() => setResult(null)}
            className="px-5 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm"
          >
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Create Agent</h1>
        <p className="text-gray-400 mt-1">
          Register an on-chain AI agent. Add private metadata to mint an ERC-7857 NFT with
          encrypted storage on 0G.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identity */}
        <fieldset className="space-y-4 p-5 rounded-xl border border-gray-800 bg-gray-900/50">
          <legend className="px-2 text-sm font-semibold text-gray-300">Identity</legend>

          <Field label="Name *" name="name" placeholder="My Research Agent" required />
          <Field
            label="Description *"
            name="description"
            placeholder="What does this agent do?"
            required
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Type</label>
              <select
                name="agentType"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 focus:outline-none focus:border-violet-600 text-sm"
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <Field label="Image URL" name="imageUrl" type="url" placeholder="https://…" />
          </div>
        </fieldset>

        {/* Services */}
        <fieldset className="space-y-4 p-5 rounded-xl border border-gray-800 bg-gray-900/50">
          <legend className="px-2 text-sm font-semibold text-gray-300">Services</legend>
          <p className="text-xs text-gray-500 px-2 -mt-2">
            Define service endpoints (web, API, MCP, etc.) for your agent. ERC-8004 compliant.
          </p>

          <div className="space-y-4">
            {services.map((service, idx) => (
              <div
                key={idx}
                className="p-4 rounded-lg border border-gray-700 bg-gray-800/50 space-y-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Service Name *</label>
                    <input
                      type="text"
                      value={service.name}
                      onChange={(e) => updateService(idx, "name", e.target.value)}
                      placeholder="e.g., web, API, MCP"
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Endpoint URL *</label>
                    <input
                      type="url"
                      value={service.endpoint}
                      onChange={(e) => updateService(idx, "endpoint", e.target.value)}
                      placeholder="https://…"
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Version (optional)</label>
                  <input
                    type="text"
                    value={service.version || ""}
                    onChange={(e) => updateService(idx, "version", e.target.value)}
                    placeholder="e.g., 1.0.0, 2025-06-18"
                    className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500 text-sm"
                  />
                </div>
                {services.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeService(idx)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove Service
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addService}
            className="mt-4 px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm font-semibold transition-colors"
          >
            + Add Service
          </button>
        </fieldset>

        {/* Private metadata toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowPrivate((v) => !v)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                showPrivate ? "bg-violet-600 border-violet-500" : "border-gray-600"
              }`}
            >
              {showPrivate && (
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            Add private metadata (ERC-7857 encrypted NFT)
          </button>
          <p className="text-xs text-gray-600 mt-1 ml-6">
            System prompt and character file — AES-256-GCM encrypted, stored on 0G Storage.
          </p>
        </div>

        {showPrivate && (
          <fieldset className="space-y-4 p-5 rounded-xl border border-violet-900/50 bg-violet-950/20">
            <legend className="px-2 text-sm font-semibold text-violet-300">
              Private Metadata
              <span className="text-violet-500 font-normal ml-1">— encrypted on-chain</span>
            </legend>

            <div>
              <label className="block text-sm text-gray-400 mb-1">System Prompt</label>
              <textarea
                name="systemPrompt"
                rows={5}
                placeholder="You are a helpful AI assistant…"
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y font-mono"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Character Definition</label>
              <textarea
                name="characterDef"
                rows={3}
                placeholder='{"name": "Agent", "personality": "helpful"}'
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm resize-y font-mono"
              />
            </div>
          </fieldset>
        )}

        {result?.error && (
          <p className="text-sm text-red-400 bg-red-950/40 px-3 py-2 rounded-lg">{result.error}</p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Agent"}
          </button>
          <a href="/" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-600 text-sm"
      />
    </div>
  );
}
