#!/usr/bin/env node
// setup-env.mjs
// Reads Hardhat Ignition deployed_addresses.json and writes apps/dashboard/.env.local
//
// Usage:
//   node contracts/scripts/setup-env.mjs [chainId]
//   node contracts/scripts/setup-env.mjs 16602   # default 0G Galileo

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const chainId = process.argv[2] ?? "16602";

const deployedPath = join(
  ROOT,
  "contracts/ignition/deployments",
  `chain-${chainId}`,
  "deployed_addresses.json",
);

if (!existsSync(deployedPath)) {
  console.error(`\nERROR: No deployment found at:\n  ${deployedPath}\n`);
  console.error(`Run: cd contracts && npx hardhat ignition deploy ignition/modules/... --network <name>\n`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(deployedPath, "utf8"));

// Map Ignition module keys → env var names
const KEY_MAP = {
  "OpenAgentsToolkit#AgentRegistry":      "AGENT_REGISTRY_ADDRESS",
  "OpenAgentsToolkit#ReputationRegistry": "REPUTATION_REGISTRY_ADDRESS",
  "OpenAgentsToolkit#ValidationRegistry": "VALIDATION_REGISTRY_ADDRESS",
  "OpenAgentsToolkit#TEEVerifier":        "NEXT_PUBLIC_TEE_VERIFIER_ADDRESS",
};

const resolved = {};
for (const [ignitionKey, envKey] of Object.entries(KEY_MAP)) {
  if (raw[ignitionKey]) {
    resolved[envKey] = raw[ignitionKey];
  }
}

if (Object.keys(resolved).length === 0) {
  console.error("ERROR: No matching contract addresses found in deployed_addresses.json");
  process.exit(1);
}

// Write to .env if it exists, otherwise .env.local
const envPath = join(ROOT, "apps/dashboard/.env");
const envLocalPath = join(ROOT, "apps/dashboard/.env.local");
const targetPath = existsSync(envPath) ? envPath : envLocalPath;

// Read existing file or start fresh
let existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";

// Upsert each env var
for (const [key, value] of Object.entries(resolved)) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(existing)) {
    existing = existing.replace(regex, `${key}=${value}`);
  } else {
    existing += `\n${key}=${value}`;
  }
}

// Ensure RPC_URL default if missing
if (!/^RPC_URL=/m.test(existing)) {
  if (chainId === "16602") {
    existing += "\nRPC_URL=https://evmrpc-testnet.0g.ai";
  }
}
const networkByChainId = {
  "1": "mainnet",
  "16602": "0gTestnet",
  "16661": "0gMainnet",
  "11155111": "sepolia",
};
const network = networkByChainId[chainId] ?? "0gTestnet";
const networkRegex = /^NETWORK=.*$/m;
if (networkRegex.test(existing)) {
  existing = existing.replace(networkRegex, `NETWORK=${network}`);
} else {
  existing += `\nNETWORK=${network}`;
}

const targetFile = targetPath === envPath ? "apps/dashboard/.env" : "apps/dashboard/.env.local";
writeFileSync(targetPath, existing.trimStart() + "\n");

console.log(`\n✓ Written to ${targetFile} (chain ${chainId})\n`);
for (const [k, v] of Object.entries(resolved)) {
  console.log(`  ${k}=${v}`);
}
console.log();
