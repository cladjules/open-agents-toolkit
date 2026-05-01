#!/usr/bin/env node
// Regenerates ABI files from compiled Hardhat artifacts.
// Run after `hardhat compile`: node contracts/scripts/gen-abis.mjs
//
// Writes to:
//   packages/agent-nft/src/abis.ts  — consumed by @open-agents-toolkit/agent-nft

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = resolve(__dirname, "../artifacts/src");
const agentNftSrc = resolve(__dirname, "../../packages/agent-nft/src");

function readAbi(contractPath) {
  const json = JSON.parse(readFileSync(resolve(artifactsDir, contractPath), "utf8"));
  return json.abi.map((e) => JSON.stringify(e)).join(",\n  ");
}

function buildContent(header) {
  return `${header}
export const AGENT_REGISTRY_ABI = [
  ${readAbi("AgentRegistry.sol/AgentRegistry.json")}
] as const;

export const AGENT_NFT_ABI = AGENT_REGISTRY_ABI;

export const REPUTATION_REGISTRY_ABI = [
  ${readAbi("ReputationRegistry.sol/ReputationRegistry.json")}
] as const;

export const TEE_VERIFIER_ABI = [
  ${readAbi("TEEVerifier.sol/TEEVerifier.json")}
] as const;

export const VALIDATION_REGISTRY_ABI = [
  ${readAbi("ValidationRegistry.sol/ValidationRegistry.json")}
] as const;

export const ENS_AGENT_REGISTRY_ABI = [
  ${readAbi("ENSAgentRegistry.sol/ENSAgentRegistry.json")}
] as const;
`;
}

const header = "// Auto-generated from Hardhat artifacts. Do not edit manually.\n// Regenerate with: node contracts/scripts/gen-abis.mjs";

for (const outPath of [
  resolve(agentNftSrc, "abis.ts"),
]) {
  writeFileSync(outPath, buildContent(header), "utf8");
  console.log(`Written: ${outPath}`);
}


