import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Registered Agents
          </h1>
          <p className="text-gray-400 mt-2 max-w-xl">
            On-chain AI agents with ERC-8004 identity and optional ERC-7857 NFT ownership.
          </p>
        </div>
        <a
          href="/agents/new"
          className="px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
        >
          + Create Agent
        </a>
      </div>

      <Suspense
        fallback={
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-xl bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        }
      >
        <AgentList />
      </Suspense>
    </div>
  );
}


