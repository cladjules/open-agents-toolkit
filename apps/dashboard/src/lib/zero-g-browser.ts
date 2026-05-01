"use client";

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { BrowserProvider } from "ethers";
import { getZeroGConfig } from "@/lib/zero-g-config";

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export async function uploadJsonWithConnectedWallet(
  data: unknown,
  chainId: number,
  provider: Eip1193Provider,
): Promise<{ cid: string; url: string; size: number }> {
  const { rpcUrl, indexerUrl } = getZeroGConfig(chainId);

  const browserProvider = new BrowserProvider(provider);
  const signer = await browserProvider.getSigner();
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const indexer = new Indexer(indexerUrl);
  const memData = new MemData(bytes);

  const [tx, err] = await indexer.upload(memData, rpcUrl, signer as never);
  if (err || !tx) {
    throw new Error(String(err ?? "0G upload failed."));
  }

  const rootHash =
    "rootHash" in tx
      ? (tx as { rootHash: string }).rootHash
      : (tx as { rootHashes: string[] }).rootHashes[0]!;

  return {
    cid: rootHash,
    url: `zerog://${rootHash}`,
    size: bytes.length,
  };
}