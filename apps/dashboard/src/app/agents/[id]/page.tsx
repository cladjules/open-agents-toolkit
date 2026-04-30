import { notFound } from "next/navigation";
import { getAgent } from "@/lib/actions/registry";
import AgentDetailActions from "./AgentDetailActions";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  return {
    title: `Agent #${id} — Open Agents Toolkit`,
    description: `View and manage on-chain AI agent #${id}`,
  };
}

export default async function AgentDetailPage({ params }: Props) {
  const { id } = await params;
  const agent = await getAgent(BigInt(id));

  if (!agent) notFound();

  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        {agent.metadata.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.metadata.image}
            alt={agent.metadata.name}
            className="w-16 h-16 rounded-xl object-cover border border-gray-700 flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold">{agent.metadata.name}</h1>
            <span className="text-sm font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              #{agent.agentId.toString()}
            </span>
          </div>
          <p className="text-gray-400 mt-2">{agent.metadata.description}</p>
        </div>
        <a
          href="/"
          className="flex-shrink-0 px-4 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm transition-colors"
        >
          ← All Agents
        </a>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Identity */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">Identity</h2>
          <DetailRow label="Agent ID" value={`#${agent.agentId.toString()}`} mono />
          <DetailRow label="Owner" value={agent.owner} mono truncate />
          {agent.agentWallet && agent.agentWallet !== "0x0000000000000000000000000000000000000000" && (
            <DetailRow label="Agent Wallet" value={agent.agentWallet} mono truncate />
          )}
          <DetailRow label="Metadata URI" value={agent.metadataUri} mono truncate />
        </section>

        {/* Capabilities */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">Capabilities</h2>
          {agent.metadata.capabilities && agent.metadata.capabilities.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {agent.metadata.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="text-sm px-3 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700"
                >
                  {cap}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No capabilities listed.</p>
          )}
        </section>

        {/* Endpoints */}
        <section className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-3 md:col-span-2">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider">Endpoints</h2>
          {(agent.metadata.endpoints?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {agent.metadata.endpoints?.map((ep, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 font-mono text-xs uppercase">
                    {ep.protocol}
                  </span>
                  <span className="text-gray-300 font-mono break-all">{ep.url}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No endpoints configured.</p>
          )}
        </section>
      </div>

      {/* Actions */}
      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Actions</h2>
          <p className="text-gray-500 text-sm mt-1">
            ERC-7857 NFT operations and ERC-8004 registry interactions for this agent.
          </p>
        </div>
        <AgentDetailActions agentId={id} />
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span
        className={`text-gray-200 text-right break-all ${mono ? "font-mono" : ""} ${truncate ? "truncate max-w-[200px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
