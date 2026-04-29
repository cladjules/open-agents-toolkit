/**
 * E2E script: register an agent on 0G Galileo and transfer it.
 *
 *   npm run e2e:zeroG
 *
 * Requires in .env:
 *   PRIVATE_KEY              — deployer / token owner key
 *
 * Oracle — pick ONE:
 *   ORACLE_SERVER_URL        — local oracle server (npm run oracle:start)
 *   ORACLE_PROVIDER_ADDRESS  — 0G Compute provider (production)
 * Optional:
 *   ZERO_G_RPC_URL           — defaults to https://evmrpc-testnet.0g.ai
 */
import "dotenv/config";
import { secp256k1 } from "@noble/curves/secp256k1";
import { createPublicClient, createWalletClient, http, parseEventLogs, keccak256, encodePacked } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

const ORACLE_SERVER_URL = "http://localhost:3100";

const chain = {
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const deployedAddresses = JSON.parse(
  readFileSync(resolve(__dirname, "../ignition/deployments/chain-16602/deployed_addresses.json"), "utf8")
);
const AGENT_REGISTRY_ADDRESS = deployedAddresses["OpenAgentsToolkit#AgentRegistry"] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses["OpenAgentsToolkit#TEEVerifier"] as `0x${string}`;

// ── ABI (minimal) ─────────────────────────────────────────────────────────────

const REGISTRY_ABI = [
  { type: "function", name: "register", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "publicMetadataUri", type: "string" }, { name: "encryptedDataHash", type: "bytes32" }, { name: "verifier", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "ownerOf", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "transferFrom", inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "secureTransfer", inputs: [{ name: "tokenId", type: "uint256" }, { name: "to", type: "address" }, { name: "newDataHash", type: "bytes32" }, { name: "sealedKey", type: "bytes" }, { name: "proof", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "event", name: "SealedKeyPublished", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "sealedKey", type: "bytes", indexed: false }] },
  { type: "event", name: "Registered", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string" }, { name: "owner", type: "address", indexed: true }] },
] as const;

// ── Clients ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

const recipientPrivKey = generatePrivateKey();
const recipientAccount = privateKeyToAccount(recipientPrivKey);
const recipient = recipientAccount.address;
const NEW_OWNER_PUBLIC_KEY = ("0x" + Buffer.from(secp256k1.getPublicKey(recipientPrivKey.slice(2), true)).toString("hex")) as `0x${string}`;
console.log(`Recipient:     ${recipient}`);
console.log(`Recipient key: ${NEW_OWNER_PUBLIC_KEY}`);

// ── Oracle helper ─────────────────────────────────────────────────────────────

type ReEncryptResult = { newDataHash: `0x${string}`; sealedKey: `0x${string}`; proof: `0x${string}` };

async function requestReEncryption(params: {
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  encryptedDataHash: `0x${string}`;
  newOwnerPublicKey: `0x${string}`;
  contentKey: Uint8Array;
}): Promise<ReEncryptResult | undefined> {
  if (ORACLE_SERVER_URL) {
    const res = await fetch(`${ORACLE_SERVER_URL}/reencrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...params,
        tokenId: params.tokenId.toString(),
        contentKey: Buffer.from(params.contentKey).toString("base64"),
      }),
    });
    if (!res.ok) throw new Error(`Oracle server: ${res.status} ${await res.text()}`);
    const { newDataHash, sealedKey, signature } = await res.json() as { newDataHash: `0x${string}`; sealedKey: `0x${string}`; signature: `0x${string}` };
    return { newDataHash, sealedKey, proof: signature };
  }
}

// ── Test 1: Simple agent (ERC-8004 register + transferFrom) ───────────────────

async function testSimpleAgent() {
  console.log("\n── Test 1: Simple agent (ERC-8004) ──────────────────────────────");
  console.log(`  Sender:    ${account.address}`);
  console.log(`  Recipient: ${recipient}`);

  const supplyBefore = await publicClient.readContract({ address: AGENT_REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "totalSupply" });

  console.log(`  Registering agent...`);
  const registerHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: ["zerog://e2e-test-agent"],
  });
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
  console.log(`  ✔ register tx: ${registerHash}`);

  const logs = parseEventLogs({ abi: REGISTRY_ABI, logs: registerReceipt.logs, eventName: "Registered" });
  const agentId = logs[0].args.agentId;
  console.log(`  ✔ agentId: ${agentId}`);

  const ownerBefore = await publicClient.readContract({ address: AGENT_REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "ownerOf", args: [agentId] });
  console.log(`  Owner before transfer: ${ownerBefore}`);

  console.log(`  Transferring to ${recipient}...`);
  const transferHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "transferFrom",
    args: [account.address, recipient, agentId],
  });
  await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log(`  ✔ transferFrom tx: ${transferHash}`);

  const ownerAfter = await publicClient.readContract({ address: AGENT_REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "ownerOf", args: [agentId] });
  console.log(`  Owner after transfer: ${ownerAfter}`);

  if (ownerAfter.toLowerCase() !== recipient.toLowerCase()) throw new Error("Transfer failed: unexpected owner");
  console.log(`  ✔ PASSED`);
}

// ── Test 2: Secure agent (ERC-7857 mint + secureTransfer via 0G Compute oracle) ─

async function testSecureAgent() {
  console.log("\n── Test 2: Secure agent (ERC-7857) ──────────────────────────────");

  const encryptedDataHash = keccak256(encodePacked(["string"], ["mock-encrypted-key"]));
  console.log(`  Minting with TEEVerifier...`);
  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "mint",
    args: [account.address, "zerog://e2e-secure-agent", encryptedDataHash, TEE_VERIFIER_ADDRESS],
  });
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`  ✔ mint tx: ${mintHash}`);

  const logs = parseEventLogs({ abi: REGISTRY_ABI, logs: mintReceipt.logs, eventName: "Registered" });
  const tokenId = logs[0].args.agentId;
  console.log(`  ✔ tokenId: ${tokenId}`);

  console.log(`  Requesting re-encryption from oracle (${ORACLE_SERVER_URL ? "local" : "0G Compute"})...`);
  const result = await requestReEncryption({
    tokenId,
    from: account.address,
    to: recipient,
    encryptedDataHash,
    contentKey: new Uint8Array(32), // placeholder — replace with real content key
    newOwnerPublicKey: NEW_OWNER_PUBLIC_KEY,
  });

  if (!result) throw new Error("No oracle configured");
  const { newDataHash, sealedKey, proof } = result;

  console.log(`  ✔ oracle returned proof`);

  console.log(`  Calling secureTransfer...`);
  const secureHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "secureTransfer",
    args: [tokenId, recipient, newDataHash, sealedKey, proof],
  });
  await publicClient.waitForTransactionReceipt({ hash: secureHash });
  console.log(`  ✔ secureTransfer tx: ${secureHash}`);

  const ownerAfter = await publicClient.readContract({ address: AGENT_REGISTRY_ADDRESS, abi: REGISTRY_ABI, functionName: "ownerOf", args: [tokenId] });
  if (ownerAfter.toLowerCase() !== recipient.toLowerCase()) throw new Error("Secure transfer failed: unexpected owner");
  console.log(`  ✔ PASSED`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log(`AgentRegistry: ${AGENT_REGISTRY_ADDRESS}`);
console.log(`TEEVerifier:   ${TEE_VERIFIER_ADDRESS}`);

await testSimpleAgent();
await testSecureAgent();
console.log("\n✔ All tests passed");
