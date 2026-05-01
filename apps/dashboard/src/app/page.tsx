import { Suspense } from "react";
import AgentList from "@/components/registry/AgentList";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="space-y-6">
        <div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Open Agents Toolkit
          </h1>
          <p className="text-xl text-gray-300 mt-3 max-w-2xl">
            Build, register, and operate AI agents on-chain. Complete ownership,
            verifiable identity, and transparent reputation.
          </p>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2">
          <h3 className="font-semibold text-violet-400">NFT Identity</h3>
          <p className="text-sm text-gray-400">
            Every agent is an ERC-721 NFT. Own your agent, transfer it, and
            control access.
          </p>
        </div>
        <div className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2">
          <h3 className="font-semibold text-violet-400">Reputation System</h3>
          <p className="text-sm text-gray-400">
            Earn feedback through ERC-8004 reputation registry. Build trust with
            transparent scoring.
          </p>
        </div>
        <div className="p-5 rounded-xl border border-gray-800 bg-gray-900/50 space-y-2">
          <h3 className="font-semibold text-violet-400">Encrypted Metadata</h3>
          <p className="text-sm text-gray-400">
            Store private prompts and configuration securely. Only accessible by
            the owner.
          </p>
        </div>
      </div>

      {/* What You Can Do Section */}
      <div className="p-6 rounded-xl border border-gray-800 bg-gray-900/30 space-y-4">
        <h2 className="text-2xl font-semibold">Start Building</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
          <div className="flex gap-3">
            <span className="text-violet-400 font-semibold">✓</span>
            <span>
              Register a new AI agent with EIP-8004 metadata and services
            </span>
          </div>
          <div className="flex gap-3">
            <span className="text-violet-400 font-semibold">✓</span>
            <span>Manage endpoints for web, A2A, MCP, and other protocols</span>
          </div>
          <div className="flex gap-3">
            <span className="text-violet-400 font-semibold">✓</span>
            <span>
              Securely store encrypted system prompts and configuration
            </span>
          </div>
          <div className="flex gap-3">
            <span className="text-violet-400 font-semibold">✓</span>
            <span>Submit and receive feedback to build reputation</span>
          </div>
        </div>
        <a
          href="/agents/new"
          className="inline-block mt-2 px-5 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors"
        >
          Create Your First Agent
        </a>
      </div>

      {/* Registered Agents Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-3xl font-bold">Registered Agents</h2>
            <p className="text-gray-400 mt-1">
              Browse all agents on the network and interact with them.
            </p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-gray-800/50 animate-pulse"
                />
              ))}
            </div>
          }
        >
          <AgentList />
        </Suspense>
      </div>
    </div>
  );
}
