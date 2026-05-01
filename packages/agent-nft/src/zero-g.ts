/**
 * 0G Storage upload helper.
 *
 * Uses @0gfoundation/0g-ts-sdk to store data on the 0G decentralised
 * storage network.  The Merkle root hash acts as the content identifier;
 * retrieval requires the 0G SDK or a compatible gateway.
 *
 * Set NETWORK=0gTestnet or NETWORK=0gMainnet (or pass network/rpcUrl/indexerUrl
 * explicitly) to target the correct cluster.
 */

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { RegistryError, getNetworkConfig, resolveNetworkConfig } from "@open-agents-toolkit/core";
import type { IPFSUploadResult } from "@open-agents-toolkit/core";
import type { NetworkId } from "@open-agents-toolkit/core";
import createDebug from "debug";

const log = createDebug("oat:zero-g");
const logUpload = createDebug("oat:zero-g:upload");

export interface ZeroGStorageOptions {
  /**
   * Network to target. Drives default rpcUrl and indexerUrl.
   * Reads the NETWORK env var when omitted. Must be "0gTestnet" or "0gMainnet".
   */
  network?: NetworkId;
  /**
   * EVM RPC endpoint for the 0G chain.
   * Defaults to the public RPC for the selected network.
   */
  rpcUrl?: string;
  /**
   * 0G Indexer RPC URL (turbo mode).
   * Defaults to the turbo indexer for the selected network.
   */
  indexerUrl?: string;
  /** 0x-prefixed hex private key used to sign upload transactions */
  privateKey: string;
}

export interface ZeroGReadOptions {
  network?: NetworkId;
  rpcUrl?: string;
  indexerUrl?: string;
}

function getIndexerUrl(opts?: ZeroGReadOptions): string {
  const networkCfg = opts?.network ? getNetworkConfig(opts.network) : resolveNetworkConfig();

  if (!networkCfg.zeroG) {
    throw new Error(
      `Network "${networkCfg.id}" does not support 0G Storage. Use 0gTestnet or 0gMainnet.`,
    );
  }

  return opts?.indexerUrl ?? networkCfg.zeroG.storageIndexerUrl;
}

function getRootHashFromUrl(uri: string): string {
  return uri.startsWith("zerog://") ? uri.slice("zerog://".length) : uri;
}

export async function readZeroGBytes(uri: string, opts?: ZeroGReadOptions): Promise<Uint8Array> {
  const rootHash = getRootHashFromUrl(uri);
  const indexer = new Indexer(getIndexerUrl(opts));
  const [blob, err] = await indexer.downloadToBlob(rootHash);

  if (err || !blob) {
    throw new RegistryError(
      "STORAGE_ERROR",
      `0G Storage download failed for ${uri}: ${String(err ?? "unknown error")}`,
      err,
    );
  }

  return new Uint8Array(await blob.arrayBuffer());
}

export async function readZeroGJSON<T>(uri: string, opts?: ZeroGReadOptions): Promise<T> {
  const bytes = await readZeroGBytes(uri, opts);

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (err) {
    throw new RegistryError(
      "INVALID_METADATA",
      `0G Storage JSON decode failed for ${uri}: ${String(err)}`,
      err,
    );
  }
}

export class ZeroGStorageClient {
  private readonly _rpcUrl: string;
  private readonly _indexerUrl: string;
  private readonly _privateKey: string;

  constructor(opts: ZeroGStorageOptions) {
    const networkCfg = opts.network ? getNetworkConfig(opts.network) : resolveNetworkConfig();

    if (!networkCfg.zeroG) {
      throw new Error(
        `Network "${networkCfg.id}" does not support 0G Storage. Use 0gTestnet or 0gMainnet.`,
      );
    }

    this._rpcUrl = opts.rpcUrl ?? networkCfg.rpcUrl;
    this._indexerUrl = opts.indexerUrl ?? networkCfg.zeroG.storageIndexerUrl;
    this._privateKey = opts.privateKey;
    log(
      "initialised network=%s rpcUrl=%s indexerUrl=%s",
      networkCfg.id,
      this._rpcUrl,
      this._indexerUrl,
    );
  }

  /**
   * Upload a JSON-serialisable object to 0G Storage.
   * Returns the rootHash (as `cid`), a `zerog://` URI, and byte size.
   */
  async uploadJSON(data: unknown): Promise<IPFSUploadResult> {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    logUpload("uploadJSON size=%d bytes", bytes.length);
    return this.uploadBytes(bytes);
  }

  /**
   * Upload raw bytes to 0G Storage.
   */
  async uploadBytes(bytes: Uint8Array): Promise<IPFSUploadResult> {
    logUpload("uploadBytes size=%d bytes indexerUrl=%s", bytes.length, this._indexerUrl);
    try {
      const provider = new ethers.JsonRpcProvider(this._rpcUrl);
      const signer = new ethers.Wallet(this._privateKey, provider);
      const indexer = new Indexer(this._indexerUrl);
      const memData = new MemData(bytes);

      logUpload("submitting to 0G Storage indexer...");
      // ethers v6 is runtime-compatible with the SDK's ethers v5 Signer interface.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [tx, err] = await indexer.upload(memData, this._rpcUrl, signer as any);

      if (err || !tx) {
        throw new Error(String(err ?? "no transaction returned"));
      }

      const rootHash =
        "rootHash" in tx
          ? (tx as { rootHash: string }).rootHash
          : (tx as { rootHashes: string[] }).rootHashes[0];

      logUpload("upload succeeded rootHash=%s size=%d", rootHash, bytes.length);
      return { cid: rootHash, url: `zerog://${rootHash}`, size: bytes.length };
    } catch (err) {
      log("upload failed: %s", String(err));
      throw new RegistryError("STORAGE_ERROR", `0G Storage upload failed: ${String(err)}`, err);
    }
  }

  getURL(rootHash: string): string {
    return `zerog://${rootHash}`;
  }
}
