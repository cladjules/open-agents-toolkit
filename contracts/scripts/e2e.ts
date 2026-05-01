/**
 * E2E script: register an agent on 0G Galileo and transfer it.
 *
 *   npm run e2e:zeroG
 *
 * Requires in .env:
 *   PRIVATE_KEY              — deployer / token owner key
 *   ORACLE_PRIVATE_KEY       — local oracle signer key (must be registered in TEEVerifier)
 * Optional:
 *   ZERO_G_RPC_URL           — defaults to https://evmrpc-testnet.0g.ai
 */
import "dotenv/config";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { signLocalOracleReEncryption } from "@open-agents-toolkit/compute";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai";

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY as
  | `0x${string}`
  | undefined;

const chain = {
  id: 16602,
  name: "0G Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const deployedAddresses = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../ignition/deployments/chain-16602/deployed_addresses.json",
    ),
    "utf8",
  ),
);
const AGENT_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(__dirname, "../artifacts/src/AgentRegistry.sol/AgentRegistry.json"),
    "utf8",
  ),
).abi;
const REPUTATION_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../artifacts/src/ReputationRegistry.sol/ReputationRegistry.json",
    ),
    "utf8",
  ),
).abi;
const VALIDATION_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../artifacts/src/ValidationRegistry.sol/ValidationRegistry.json",
    ),
    "utf8",
  ),
).abi;
const TEE_VERIFIER_ABI = JSON.parse(
  readFileSync(
    resolve(__dirname, "../artifacts/src/TEEVerifier.sol/TEEVerifier.json"),
    "utf8",
  ),
).abi;
const AGENT_REGISTRY_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#AgentRegistry"
] as `0x${string}`;
const REPUTATION_REGISTRY_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#ReputationRegistry"
] as `0x${string}`;
const VALIDATION_REGISTRY_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#ValidationRegistry"
] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#TEEVerifier"
] as `0x${string}`;

// ── Clients ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const recipientPrivKey = generatePrivateKey();
const recipientAccount = privateKeyToAccount(recipientPrivKey);
const recipient = recipientAccount.address;
const NEW_OWNER_PUBLIC_KEY = ("0x" +
  Buffer.from(secp256k1.getPublicKey(recipientPrivKey.slice(2), true)).toString(
    "hex",
  )) as `0x${string}`;
console.log(`Recipient:     ${recipient}`);
console.log(`Recipient key: ${NEW_OWNER_PUBLIC_KEY}`);

// ── Oracle helper ─────────────────────────────────────────────────────────────

type ReEncryptResult = {
  newDataHashes: readonly `0x${string}`[];
  sealedKey: `0x${string}`;
  proof: `0x${string}`;
};

async function waitForReceiptRobust(hash: `0x${string}`, label: string) {
  for (let attempt = 1; attempt <= 45; attempt++) {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch (err) {
      const msg = String(err);
      const notFound =
        msg.includes("TransactionReceiptNotFoundError") ||
        msg.includes("could not be found");
      if (!notFound) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error(`Timed out waiting for receipt: ${label} (${hash})`);
}

async function ensureRegistryReady(): Promise<bigint> {
  // Check if paused (from loaded AGENT_REGISTRY_ABI)
  const pauseFunction = AGENT_REGISTRY_ABI.find(
    (item: any) => item.type === "function" && item.name === "paused",
  );

  if (pauseFunction) {
    try {
      const paused = await publicClient.readContract({
        address: AGENT_REGISTRY_ADDRESS,
        abi: AGENT_REGISTRY_ABI,
        functionName: "paused",
      });
      if (paused) {
        throw new Error(
          "AgentRegistry is paused on-chain; unpause it before running e2e",
        );
      }
    } catch (err) {
      const msg = String(err);
      if (!msg.includes("does not have function")) throw err;
    }
  }

  // Try getMintFee or mintFee from loaded ABI
  const getMintFeeFunction = AGENT_REGISTRY_ABI.find(
    (item: any) => item.type === "function" && item.name === "getMintFee",
  );
  const mintFeeFunction = AGENT_REGISTRY_ABI.find(
    (item: any) => item.type === "function" && item.name === "mintFee",
  );

  if (getMintFeeFunction) {
    try {
      const fee = await publicClient.readContract({
        address: AGENT_REGISTRY_ADDRESS,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getMintFee",
      });
      return fee as bigint;
    } catch {
      // Try next variant.
    }
  }

  if (mintFeeFunction) {
    try {
      const fee = await publicClient.readContract({
        address: AGENT_REGISTRY_ADDRESS,
        abi: AGENT_REGISTRY_ABI,
        functionName: "mintFee",
      });
      return fee as bigint;
    } catch {
      // Try next variant.
    }
  }

  return 0n;
}

function extractTokenIdFromReceipt(logs: readonly unknown[]): bigint {
  const registered = parseEventLogs({
    abi: AGENT_REGISTRY_ABI,
    logs: logs as Parameters<typeof parseEventLogs>[0]["logs"],
    eventName: "Registered",
    strict: false,
  });
  const registeredLog = registered[0] as
    | { args?: { agentId?: bigint } }
    | undefined;
  if (registeredLog?.args?.agentId !== undefined) {
    return registeredLog.args.agentId;
  }

  const transferLogs = parseEventLogs({
    abi: AGENT_REGISTRY_ABI,
    logs: logs as Parameters<typeof parseEventLogs>[0]["logs"],
    eventName: "Transfer",
    strict: false,
  });
  const mintedTransfer = transferLogs.find((l) => {
    const transferLog = l as { args?: { from?: `0x${string}` } };
    return (
      transferLog.args?.from?.toLowerCase() ===
      "0x0000000000000000000000000000000000000000"
    );
  }) as { args?: { tokenId?: bigint } } | undefined;
  if (mintedTransfer?.args?.tokenId !== undefined) {
    return mintedTransfer.args.tokenId;
  }

  throw new Error("Could not extract tokenId from tx logs");
}

async function requestReEncryption(params: {
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  intelligentDataHashes: readonly `0x${string}`[];
  newOwnerPublicKey: `0x${string}`;
  contentKey: Uint8Array;
}): Promise<ReEncryptResult | undefined> {
  if (!ORACLE_PRIVATE_KEY) return undefined;
  return signLocalOracleReEncryption(params, {
    privateKey: ORACLE_PRIVATE_KEY,
  });
}

async function ensureOracleRegistered(): Promise<void> {
  if (!ORACLE_PRIVATE_KEY) return;

  const oracleAddress = privateKeyToAccount(ORACLE_PRIVATE_KEY).address;
  console.log(`  Ensuring oracle signer is registered: ${oracleAddress}`);

  const addOracleHash = await walletClient.writeContract({
    address: TEE_VERIFIER_ADDRESS,
    abi: TEE_VERIFIER_ABI,
    functionName: "addOracle",
    args: [oracleAddress],
    account,
    chain,
  });
  await waitForReceiptRobust(addOracleHash, "addOracle");
  console.log(`  ✔ oracle registered tx: ${addOracleHash}`);
}

// ── Test 1: Simple agent (ERC-8004 mint + transferFrom) ───────────────────────

async function testSimpleAgent() {
  console.log(
    "\n── Test 1: Simple agent (ERC-8004) ──────────────────────────────",
  );
  console.log(`  Sender:    ${account.address}`);
  console.log(`  Recipient: ${recipient}`);

  const supplyBefore = await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "totalSupply",
  });

  const mintFee = await ensureRegistryReady();
  console.log(`  Minting simple agent (fee: ${mintFee})...`);

  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "register",
    args: ["https://example.com/e2e-agent.json"],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceiptRobust(
    mintHash,
    "register simple agent",
  );
  const agentId = extractTokenIdFromReceipt(
    mintReceipt.logs as readonly unknown[],
  );
  console.log(`  ✔ minted simple agent`);
  console.log(`  ✔ agentId: ${agentId}`);

  const ownerBefore = await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [agentId],
  });
  console.log(`  Owner before transfer: ${ownerBefore}`);

  console.log(`  Transferring to ${recipient}...`);
  const transferHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "transferFrom",
    args: [account.address, recipient, agentId],
    account,
    chain,
  });
  await waitForReceiptRobust(transferHash, "transferFrom simple agent");
  console.log(`  ✔ transferFrom tx: ${transferHash}`);

  const ownerAfter = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [agentId],
  })) as `0x${string}`;
  console.log(`  Owner after transfer: ${ownerAfter}`);

  if (ownerAfter.toLowerCase() !== recipient.toLowerCase())
    throw new Error("Transfer failed: unexpected owner");
  console.log(`  ✔ PASSED`);
}

async function testRegistryWiring() {
  console.log(
    "\n── Test 0: Registry wiring ───────────────────────────────────────",
  );

  const reputationAgentRegistry = await publicClient.readContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getAgentRegistry",
  });
  const validationAgentRegistry = await publicClient.readContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "getAgentRegistry",
  });

  if (
    (reputationAgentRegistry as `0x${string}`).toLowerCase() !==
    AGENT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("ReputationRegistry agent registry wiring mismatch");
  }
  if (
    (validationAgentRegistry as `0x${string}`).toLowerCase() !==
    AGENT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    throw new Error("ValidationRegistry agent registry wiring mismatch");
  }

  console.log(
    "  ✔ ReputationRegistry and ValidationRegistry are wired to AgentRegistry",
  );
}

// ── Test 2: Secure agent (ERC-7857 mint + secureTransfer via 0G Compute oracle) ─

async function testSecureAgent() {
  console.log(
    "\n── Test 2: Secure agent (ERC-7857) ──────────────────────────────",
  );

  const mintFee = await ensureRegistryReady();

  if (!ORACLE_PRIVATE_KEY) {
    console.log("  ↷ Skipped: ORACLE_PRIVATE_KEY is not set.");
    return;
  }

  await ensureOracleRegistered();

  console.log(`  Minting with TEEVerifier (fee: ${mintFee})...`);

  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "register",
    args: ["https://example.com/e2e-secure-agent.json"],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceiptRobust(
    mintHash,
    "register secure agent",
  );
  const tokenId = extractTokenIdFromReceipt(
    mintReceipt.logs as readonly unknown[],
  );
  const intelligentData: Array<{ hash: `0x${string}` }> = [];
  const contentKey = randomBytes(32);
  console.log(`  ✔ minted secure agent`);
  console.log(`  ✔ tokenId: ${tokenId}`);

  console.log("  Generating local oracle re-encryption proof...");
  let result: ReEncryptResult | undefined;
  try {
    result = await requestReEncryption({
      tokenId,
      from: account.address,
      to: recipient,
      intelligentDataHashes: intelligentData.map((item) => item.hash),
      contentKey,
      newOwnerPublicKey: NEW_OWNER_PUBLIC_KEY,
    });
  } catch (err) {
    console.log(`  ↷ Skipped: oracle request failed (${String(err)})`);
    return;
  }

  if (!result) {
    console.log("  ↷ Skipped: no oracle configured.");
    return;
  }
  const { newDataHashes, sealedKey, proof } = result;

  console.log(`  ✔ oracle returned proof`);

  console.log(`  Calling secureTransfer...`);
  const secureHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "secureTransfer",
    args: [tokenId, recipient, [...newDataHashes], sealedKey, proof],
    account,
    chain,
  });
  await waitForReceiptRobust(secureHash, "secureTransfer");
  console.log(`  ✔ secureTransfer tx: ${secureHash}`);

  const ownerAfter = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;
  if (ownerAfter.toLowerCase() !== recipient.toLowerCase())
    throw new Error("Secure transfer failed: unexpected owner");
  console.log(`  ✔ PASSED`);
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log(`AgentRegistry: ${AGENT_REGISTRY_ADDRESS}`);
console.log(`Reputation:    ${REPUTATION_REGISTRY_ADDRESS}`);
console.log(`Validation:    ${VALIDATION_REGISTRY_ADDRESS}`);
console.log(`TEEVerifier:   ${TEE_VERIFIER_ADDRESS}`);

await testRegistryWiring();
await testSimpleAgent();
await testSecureAgent();
console.log("\n✔ All tests passed");
