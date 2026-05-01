/**
 * WalletAdapter — the unified interface that abstracts over EIP-6963
 * (browser injected providers) and WalletConnect v2 (headless / server).
 *
 * Implementors: EIP6963Adapter (packages/ows) and WalletConnectAdapter (packages/ows).
 */

import type { Address, Hex } from "viem";
import type {
  ChainId,
  TransactionRequest,
  TransactionResult,
  WalletConnectionState,
} from "./types.js";

export interface WalletAdapter {
  /** Current connection state */
  readonly state: WalletConnectionState;

  /**
   * Initiate the connection flow.
   * Resolves once the user has authorised the connection.
   */
  connect(options?: ConnectOptions): Promise<{ address: Address; chainId: ChainId }>;

  /** Disconnect the current wallet session */
  disconnect(): Promise<void>;

  /**
   * Returns the connected wallet address.
   * Throws WalletError("WALLET_NOT_CONNECTED") if not connected.
   */
  getAddress(): Address;

  /** Returns the current chain ID */
  getChainId(): ChainId;

  /**
   * Personal sign (EIP-191).
   * Accepts a UTF-8 string or raw bytes `{ raw: Uint8Array }` for ERC-8128
   * HTTP Message Signature support.
   */
  signMessage(message: string | { raw: Uint8Array }): Promise<Hex>;

  /**
   * EIP-712 typed data sign.
   * Used by the signed-requests package and anywhere else typed signing is needed.
   */
  signTypedData(params: SignTypedDataParams): Promise<Hex>;

  /**
   * Broadcast a transaction and return the hash.
   */
  sendTransaction(tx: TransactionRequest): Promise<TransactionResult>;

  /** Cleanup subscriptions / transport resources */
  dispose(): Promise<void>;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface ConnectOptions {
  /** Preferred chain to connect on — wallet may prompt for switch */
  chainId?: ChainId;
}

export interface SignTypedDataParams {
  domain: {
    name?: string;
    version?: string;
    chainId?: ChainId;
    verifyingContract?: Address;
    salt?: Hex;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}
