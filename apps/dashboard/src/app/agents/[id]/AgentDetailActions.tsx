"use client";

import { useState, useTransition } from "react";
import {
  transferAgent,
  approveAgent,
  authorizeUsage,
  revokeAuthorization,
} from "@/lib/actions/agents";
import { giveFeedback, requestValidation } from "@/lib/actions/registry";

interface Props {
  agentId: string;
}

export default function AgentDetailActions({ agentId }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* Primary actions — always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionCard title="Give Feedback" description="Submit ERC-8004 reputation feedback.">
          <FeedbackForm agentId={agentId} />
        </ActionCard>

        <ActionCard title="Transfer" description="Move ownership to a new address.">
          <TransferForm tokenId={agentId} />
        </ActionCard>
      </div>

      {/* Secondary actions — expandable */}
      <div className="border border-gray-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-900/50 transition-colors"
        >
          <span>More actions</span>
          <span className="text-gray-600">{moreOpen ? "▲" : "▼"}</span>
        </button>

        {moreOpen && (
          <div className="border-t border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
            <SmallActionCard title="Approve Operator">
              <ApproveForm tokenId={agentId} />
            </SmallActionCard>
            <SmallActionCard title="Approve Token Operator">
              <AuthorizeUsageForm tokenId={agentId} />
            </SmallActionCard>
            <SmallActionCard title="Revoke Token Approval">
              <RevokeAuthForm tokenId={agentId} />
            </SmallActionCard>
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

// ─── Forms ────────────────────────────────────────────────────────────────────

function FeedbackForm({ agentId }: { agentId: string }) {
  const { isPending, result, run } = useActionState();
  const [feedbackJson, setFeedbackJson] = useState('{\n  "summary": "Great response quality",\n  "details": { "latencyMs": 820 }\n}');
  const feedbackJsonError = validateJsonInput(feedbackJson);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => giveFeedback(new FormData(e.currentTarget))); }}
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
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => transferAgent(new FormData(e.currentTarget))); }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Recipient Address *" name="to" placeholder="0x…" required />
      <SubmitButton isPending={isPending} label="Transfer" />
      <ResultBanner result={result} />
    </form>
  );
}

function ApproveForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => approveAgent(new FormData(e.currentTarget))); }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Spender Address *" name="spender" placeholder="0x…" required />
      <SubmitButton isPending={isPending} label="Approve" />
      <ResultBanner result={result} />
    </form>
  );
}

function AuthorizeUsageForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => authorizeUsage(new FormData(e.currentTarget))); }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Operator Address *" name="user" placeholder="0x…" required />
      <SubmitButton isPending={isPending} label="Approve Token" />
      <ResultBanner result={result} />
    </form>
  );
}

function RevokeAuthForm({ tokenId }: { tokenId: string }) {
  const { isPending, result, run } = useActionState();
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => revokeAuthorization(new FormData(e.currentTarget))); }}
      className="space-y-3"
    >
      <input type="hidden" name="tokenId" value={tokenId} />
      <Field label="Operator Address" name="user" placeholder="Optional (not used)" />
      <SubmitButton isPending={isPending} label="Revoke Approval" />
      <ResultBanner result={result} />
    </form>
  );
}

function ValidationForm({ agentId }: { agentId: string }) {
  const { isPending, result, run } = useActionState();
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); run(() => requestValidation(new FormData(e.currentTarget))); }}
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

