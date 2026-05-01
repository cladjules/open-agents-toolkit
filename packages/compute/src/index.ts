/**
 * @open-agents-toolkit/compute
 *
 * 0G Compute Network client — decentralized AI inference and
 * TEE re-encryption oracle for ERC-7857 AgentNFT secure transfers.
 */

export { ZeroGComputeClient } from "./compute-client.js";
export { signLocalOracleReEncryption } from "./oracle-signer.js";
export type {
  ZeroGComputeClientOptions,
  ReEncryptionRequest,
  ReEncryptionResult,
  InferenceRequest,
  InferenceResult,
} from "./compute-client.js";
export type { LocalOracleSignOptions } from "./oracle-signer.js";
