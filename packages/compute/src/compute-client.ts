/**
 * ZeroGComputeClient
 * ─────────────────────────────────────────────────────────────────────────────
 * TypeScript client for the 0G Compute Network.
 *
 * ## Primary use-cases
 *
 * 1. **AI inference** — call any LLM / image-gen / speech-to-text model hosted
 *    on 0G Compute providers (OpenAI-compatible API, pay per request in 0G tokens).
 *
 * 2. **AgentNFT re-encryption oracle** — route ERC-7857 transfer key handoffs
 *    through a 0G Compute TDX provider instead of running your own TEE server.
 *    The provider re-encrypts the AES content key inside an Intel TDX enclave
 *    and signs the result; the signature is used as the `proof` arg in
 *    `AgentNFT.secureTransfer()`, verified on-chain by `TEEVerifier`.
 *
 * ## 0G Compute TEE oracle flow
 *
 * ```
 *  Client                     0G Compute TDX Node                  Chain
 *  ──────                     ───────────────────                  ─────
 *  requestReEncryption()
 *    │  POST /chat/completions
 *    │  {action:"reencrypt",contentKey,newOwnerPubKey,...}
 *    ├──────────────────────>│
 *    │                       │  Re-encrypt contentKey for newOwner
 *    │                       │  Keep or derive newDataHashes for all encrypted items
 *    │                       │  Sign (tokenId,from,to,oldDataHashes,newDataHashes)
 *    │  {newDataHashes, sealedKey, signature}
 *    │<──────────────────────│
 *    │
 *    │  AgentNFT.secureTransfer(tokenId, newOwner, newDataHashes, sealedKey, signature)
 *    ├────────────────────────────────────────────────────────>  TEEVerifier.verifySignature()
 * ```
 *
 * ## Registering the oracle on-chain
 *
 * The TDX node has a deterministic ECDSA signing key derived from its enclave
 * measurements.  Register it once in your deployed `TEEVerifier`:
 *
 * ```solidity
 * teeVerifier.addOracle(0x<TDX_NODE_SIGNING_ADDRESS>);
 * ```
 *
 * ## Provider setup
 *
 * The 0G Compute provider must implement an OpenAI-compatible `/chat/completions`
 * endpoint.  When the `content` field of the first user message is a JSON string
 * with `"action":"reencrypt"`, the enclave should:
 *
 *   1. Parse `contentKey` (base64 AES-256 key), `newOwnerPublicKey` (secp256k1),
 *      `tokenId`, `from`, `to`, and `intelligentDataHashes` (the current on-chain hashes).
 *   2. Re-encrypt `contentKey` for `newOwnerPublicKey` (ECIES / X25519-ChaCha20).
 *   3. Keep or derive `newDataHashes` for each encrypted item and seal the key for the receiver.
 *   4. Build the TEE attestation hash: `keccak256(abi.encode(tokenId, from, to, oldDataHashes, newDataHashes))`.
 *   5. Sign the hash with the enclave's TDX signing key (EIP-191 personalSign).
 *   6. Return `{ newDataHashes: ["0x<32 bytes>"], sealedKey: "0x<bytes>", signature: "0x<65 bytes>" }` as the
 *      `choices[0].message.content` JSON string.
 */

import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";
import { getNetworkConfig, resolveNetworkConfig } from "@open-agents-toolkit/core";
import type { NetworkId } from "@open-agents-toolkit/core";
import createDebug from "debug";

const log = createDebug("oat:compute");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZeroGComputeClientOptions {
  /**
   * Target network. Drives the default RPC endpoint.
   * Reads NETWORK env var when omitted.
   */
  network?: NetworkId;
  /**
   * Override the RPC URL for the 0G chain.
   * Defaults to the public RPC for the resolved network.
   */
  rpcUrl?: string;
  /** 0x-prefixed private key used to pay for compute services. */
  privateKey: string;
  /**
   * 0G Compute provider address to use as the re-encryption oracle.
   * The provider must be running a custom re-encryption service
   * (see module-level comment for the expected request/response contract).
   */
  oracleProviderAddress?: string;
}

export interface ReEncryptionRequest {
  /** ERC-7857 token ID being transferred. */
  tokenId: bigint;
  /** Current owner address. */
  from: `0x${string}`;
  /** New owner address. */
  to: `0x${string}`;
  /** Current on-chain intelligent data hashes for the token. */
  intelligentDataHashes: readonly `0x${string}`[];
  /** AES-256-GCM content key to be re-encrypted (raw bytes). */
  contentKey: Uint8Array;
  /** secp256k1 public key of the new owner (used for ECIES re-encryption). */
  newOwnerPublicKey: `0x${string}`;
}

export interface ReEncryptionResult {
  /** Hashes for each encrypted item after transfer. In the key-handoff flow these can remain unchanged. */
  newDataHashes: readonly `0x${string}`[];
  /** Content key re-encrypted for the new owner, sealed with their public key. */
  sealedKey: `0x${string}`;
  /**
   * 65-byte ECDSA signature from the TDX enclave over
   * keccak256(abi.encode(tokenId, from, to, oldDataHashes, newDataHashes)).
   * Pass newDataHashes, sealedKey, and proof to `AgentNFTClient.transfer()`.
   */
  proof: `0x${string}`;
}

export interface InferenceRequest {
  /** Provider address on 0G Compute. */
  providerAddress: string;
  /** Chat messages (OpenAI-compatible). */
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /**
   * Maximum fee to pay if the provider's fee cannot be verified.
   * @default 0.001
   */
  fallbackFee?: number;
}

export interface InferenceResult {
  /** Model response content. */
  content: string;
  /** Whether the response passed TEE verification. */
  isValid: boolean;
  /** Provider address that served the request. */
  provider: string;
}

type Broker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;

// ─── Client ───────────────────────────────────────────────────────────────────

export class ZeroGComputeClient {
  private readonly _rpcUrl: string;
  private readonly _privateKey: string;
  private readonly _oracleProviderAddress: string | undefined;
  private _broker: Broker | undefined;

  constructor(opts: ZeroGComputeClientOptions) {
    const networkCfg = opts.network ? getNetworkConfig(opts.network) : resolveNetworkConfig();

    if (!networkCfg.zeroG) {
      throw new Error(
        `Network "${networkCfg.id}" is not a 0G network. Use 0gTestnet or 0gMainnet for 0G Compute.`,
      );
    }

    this._rpcUrl = opts.rpcUrl ?? networkCfg.rpcUrl;
    this._privateKey = opts.privateKey;
    this._oracleProviderAddress = opts.oracleProviderAddress;
    log(
      "initialised network=%s rpcUrl=%s oracleProvider=%s",
      networkCfg.id,
      this._rpcUrl,
      opts.oracleProviderAddress ?? "none",
    );
  }

  // ─── Broker init ──────────────────────────────────────────────────────────

  private async _broker_(): Promise<Broker> {
    if (this._broker) return this._broker;
    log("initialising 0G Compute broker rpcUrl=%s", this._rpcUrl);
    const provider = new ethers.JsonRpcProvider(this._rpcUrl);
    const wallet = new ethers.Wallet(this._privateKey, provider);
    this._broker = await createZGComputeNetworkBroker(
      wallet as unknown as Parameters<typeof createZGComputeNetworkBroker>[0],
    );
    log("broker ready");
    return this._broker;
  }

  // ─── Account setup ────────────────────────────────────────────────────────

  /**
   * One-time setup: deposit funds into the 0G Compute ledger and
   * acknowledge the oracle provider.
   *
   * Minimum `initialFunds` is 3 OG (contract requirement as of SDK v0.6.x).
   * Each provider also requires at minimum 1 OG transferred before first use.
   *
   * @param initialFunds Amount in OG tokens to deposit into the main ledger.
   * @param providerFunds Amount to transfer to the oracle provider sub-account.
   */
  async setup(initialFunds = 3, providerFunds = 1): Promise<void> {
    const broker = await this._broker_();
    await broker.ledger.depositFund(initialFunds);

    if (this._oracleProviderAddress) {
      await broker.inference.acknowledgeProviderSigner(this._oracleProviderAddress);
      await broker.ledger.transferFund(
        this._oracleProviderAddress,
        "inference",
        ethers.parseEther(String(providerFunds)),
      );
    }
  }

  // ─── Re-encryption oracle ─────────────────────────────────────────────────

  /**
   * Request key re-encryption from the configured 0G Compute TDX oracle.
   *
   * The oracle provider must implement the re-encryption service contract
   * described in this module's header comment.
   *
   * After a successful call:
   *  - `result.sealedKey` is emitted on-chain via `SealedKeyPublished` for the receiver.
   *  - Pass `result.newDataHashes`, `result.sealedKey`, and `result.proof` to
   *    `AgentNFTClient.transfer(tokenId, newOwner, result.newDataHashes, result.sealedKey, result.proof)`.
   */
  async requestReEncryption(req: ReEncryptionRequest): Promise<ReEncryptionResult> {
    if (!this._oracleProviderAddress) {
      throw new Error("oracleProviderAddress is required for re-encryption requests.");
    }

    const broker = await this._broker_();
    const { endpoint, model } = await broker.inference.getServiceMetadata(
      this._oracleProviderAddress,
    );

    const payload = JSON.stringify({
      action: "reencrypt",
      tokenId: req.tokenId.toString(),
      from: req.from,
      to: req.to,
      intelligentDataHashes: req.intelligentDataHashes,
      contentKey: Buffer.from(req.contentKey).toString("base64"),
      newOwnerPublicKey: req.newOwnerPublicKey,
    });

    const headers = await broker.inference.getRequestHeaders(this._oracleProviderAddress, payload);

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: payload }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Re-encryption request failed: ${response.status} ${await response.text()}`);
    }

    const result = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };
    const content = result.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Re-encryption oracle returned an empty response.");
    }

    // Settle payment + TEE verification
    await broker.inference.processResponse(this._oracleProviderAddress, result.id, content);

    const parsed = JSON.parse(content) as {
      newDataHashes: string[];
      sealedKey: string;
      signature: string;
    };

    return {
      newDataHashes: parsed.newDataHashes as `0x${string}`[],
      sealedKey: parsed.sealedKey as `0x${string}`,
      proof: parsed.signature as `0x${string}`,
    };
  }

  // ─── AI inference ────────────────────────────────────────────────────────

  /**
   * Send an inference request to any 0G Compute provider.
   *
   * Suitable for agent task execution — call LLMs, image gen, or speech-to-text
   * models with automatic payment and TEE verification.
   */
  async inference(req: InferenceRequest): Promise<InferenceResult> {
    const broker = await this._broker_();
    const { endpoint, model } = await broker.inference.getServiceMetadata(req.providerAddress);

    const body = JSON.stringify({ role: "user", content: req.messages.at(-1)?.content ?? "" });
    const headers = await broker.inference.getRequestHeaders(req.providerAddress, body);

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ model, messages: req.messages }),
    });

    if (!response.ok) {
      throw new Error(`Inference request failed: ${response.status} ${await response.text()}`);
    }

    const result = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };
    const content = result.choices[0]?.message?.content ?? "";

    const isValid = await broker.inference.processResponse(req.providerAddress, result.id, content);

    return { content, isValid: !!isValid, provider: req.providerAddress };
  }

  // ─── Service discovery ───────────────────────────────────────────────────

  /**
   * List all available services on the 0G Compute Network.
   * Includes model names, pricing, provider addresses, and verifiability info.
   */
  async listServices() {
    const broker = await this._broker_();
    return broker.inference.listService();
  }
}
