"use client";

import { useState } from "react";

export default function WalletConnectButton() {
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [address, setAddress] = useState<string | null>(null);

  async function handleConnect() {
    if (typeof window === "undefined") return;
    setStatus("connecting");
    try {
      // Dynamic import keeps the EIP-6963 adapter out of the server bundle
      const { EIP6963Adapter } = await import("@open-agents-toolkit/ows/eip6963");
      const adapter = new EIP6963Adapter();
      const result = await adapter.connect();
      setAddress(result.address);
      setStatus("connected");
    } catch {
      setStatus("idle");
      alert("Wallet connection failed. Install MetaMask or another EIP-6963 wallet.");
    }
  }

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-900/40 border border-green-700 text-green-400 text-sm font-mono">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        {address.slice(0, 6)}...{address.slice(-4)}
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={status === "connecting"}
      className="px-6 py-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
    >
      {status === "connecting" ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
