import { ethers } from "ethers";
import type { ReEncryptionRequest, ReEncryptionResult } from "./compute-client.js";

export interface LocalOracleSignOptions {
  /**
   * 0x-prefixed oracle key. Defaults to process.env.ORACLE_PRIVATE_KEY.
   */
  privateKey?: `0x${string}`;
}

/**
 * Development helper that mirrors the local oracle flow:
 * 1) deterministically builds a "sealed" blob from recipient pubkey + content key,
 * 2) preserves the current intelligent data hashes for the transferred ciphertext blobs,
 * 3) signs keccak256(abi.encode(tokenId, from, to, oldDataHashes, newDataHashes)) with EIP-191.
 */
export async function signLocalOracleReEncryption(
  req: ReEncryptionRequest,
  opts: LocalOracleSignOptions = {},
): Promise<ReEncryptionResult> {
  const privateKey =
    opts.privateKey ?? (process.env.ORACLE_PRIVATE_KEY as `0x${string}` | undefined);
  if (!privateKey) {
    throw new Error("ORACLE_PRIVATE_KEY is required to sign oracle re-encryption messages.");
  }

  const reEncryptedBlob = ethers.concat([ethers.getBytes(req.newOwnerPublicKey), req.contentKey]);
  const newDataHashes = [...req.intelligentDataHashes] as `0x${string}`[];
  const sealedKey = ethers.hexlify(reEncryptedBlob) as `0x${string}`;

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const innerHash = ethers.keccak256(
    abiCoder.encode(
      ["uint256", "address", "address", "bytes32[]", "bytes32[]"],
      [req.tokenId, req.from, req.to, req.intelligentDataHashes, newDataHashes],
    ),
  );

  const oracle = new ethers.Wallet(privateKey);
  const proof = (await oracle.signMessage(ethers.getBytes(innerHash))) as `0x${string}`;

  return { newDataHashes, sealedKey, proof };
}
