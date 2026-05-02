# Open Agents Toolkit

> Own, trade, and manage AI agents on blockchain as ERC-721/ERC-7857 NFTs with ERC-8004 reputation. Each agent comes with its own ENS domain, verifiable on-chain reputation, and encrypted skills that transfer securely to new owners.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)
[![ERC-8004](https://img.shields.io/badge/ERC--8004-Trustless%20Agents-purple)](https://eips.ethereum.org/EIPS/eip-8004)
[![ERC-7857](https://img.shields.io/badge/ERC--7857-Agent%20NFTs-cyan)](https://eips.ethereum.org/EIPS/eip-7857)

---

## What is it?

Open Agents Toolkit (OAT) lets you launch AI agents on blockchain as NFTs — compatible with both ERC-721 and ERC-7857 — with integrated ENS domains and ERC-8004 reputation. Each agent is a standalone, tradeable asset — when you mint an agent, it gets a dedicated `.eth` domain, on-chain reputation tracking via ERC-8004, and encrypted skills data. When you trade or transfer the agent NFT, the ENS domain, accumulated reputation, and all encrypted skills move with it to the new owner. Only approved agents or the owner can decrypt and access the agent's sensitive data (prompts, API keys, knowledge bases).

**Architecture:** The frontend (Next.js dashboard) owns all contract writes directly via viem. The SDK packages provide read-only clients, encryption/decryption utilities, and server-side helpers for data preparation and 0G Storage interactions.

---

## How It's Made

OAT is built across three layers: on-chain contracts, a TypeScript SDK monorepo, and a Next.js 15 dashboard.

**Smart contracts** (Solidity 0.8.35, Hardhat 3, `viaIR`) implement three ERC standards in a single deployment set. `AgentRegistry` is both ERC-8004 and ERC-721 — agents are minted as NFTs while the registry tracks identity, agent wallet registration (proved via EIP-712 signature), and metadata URIs stored on 0G Storage. `ReputationRegistry` (ERC-8004) stores fixed-point int128 feedback entries with Sybil-resistant client filtering exposed through a `getSummary` view. `ValidationRegistry` (ERC-8004) handles request/response cycles for TEE oracles and staker re-execution with progressive finality. `TEEVerifier` (ERC-7857) verifies ECDSA oracle attestations on-chain. `ENSAgentRegistry` maps ENS namehashes to agent identities and mirrors ownership cross-chain via a KeeperHub relayer — transferring the `.eth` domain is enough to trigger an ownership handoff without touching the NFT directly.

**Encryption stack**: private metadata (system prompts, API keys, skills) is encrypted with AES-256-GCM before leaving the browser. The AES content key is sealed to the owner's public key using ECIES. On NFT transfer, the 0G Compute oracle runs inside a TEE, unseals the old content key, re-seals it to the new owner's public key, and posts an ECDSA attestation verified on-chain by `TEEVerifier` before the transfer finalises. Content hashes are anchored on-chain so any tampering is detectable.

**0G Storage and Compute** are used throughout: all public metadata (agent registration files, service manifests) is stored on 0G Storage under `zerog://` URIs, and AI inference runs pay-per-request through the 0G Compute Network's OpenAI-compatible API.

**SDK monorepo** (`packages/`) is split into `core` (shared types, EIP-712 helpers, network config — zero runtime deps), `agent-nft` (read-only ERC-7857 client, encryption utils, 0G Storage client, server helpers), and `compute` (0G Compute inference client + re-encryption oracle wrapper).

**Frontend** (Next.js 15 App Router + viem): all contract writes happen directly in the browser via `writeContract` — no backend proxy or relayer for the happy path. Next.js Server Actions handle the only things that must stay server-side: data encryption, 0G Storage uploads, and Compute oracle calls. This keeps private keys and AES content keys off the client while avoiding any API route indirection for internal mutations.

**Notable hack**: ENS domain transfer as a cross-chain ownership trigger. Rather than requiring users to interact with the NFT contract on the target chain, transferring the `.eth` domain (which lives on Ethereum mainnet) is detected by a KeeperHub relayer that mirrors ownership to the deployment chain automatically — making the ENS name the canonical identifier for the agent across chains.

---

## Key Features

### 1. **ERC-721/ERC-7857 NFT Agents with Integrated ENS Domains**

Every agent is minted as an ERC-721/ERC-7857 NFT with a dedicated ENS domain automatically attached. This means your agent has a human-readable `.eth` address that travels with the NFT — when you trade or transfer the agent, the ENS domain and all associated data (reputation, encrypted skills) move together. Agents are fully composable with existing NFT infrastructure.

### 2. **ERC-8004 Reputation & Feedback System**

Build trust through an on-chain reputation system. Clients provide feedback and scores stored in `ReputationRegistry` with Sybil-resistant scoring. Track agent performance, receive ratings from users, and accumulate verifiable reputation that travels with your agent across chains and ownership transfers.

### 3. **Encrypted Intelligent Data with TEE Proof**

Store sensitive agent data (system prompts, API keys, skills, knowledge bases) with TEE cryptographic proof. Using AES-256-GCM encryption anchored on-chain.

- **Mint** the agent as an ERC-7857 NFT with encrypted private metadata
- **Trade** the NFT — private metadata is re-encrypted for the new owner inside a compute node, verified on-chain by `TEEVerifier`
- **Decrypt** only by approved agents or the owner, ensuring skills and data remain confidential while enabling controlled access

---

## Full Lifecycle

1. **Register** an agent on-chain with its endpoints, capabilities, and metadata stored on 0G Storage
2. **Mint** as an ERC-721 NFT with:
   - A dedicated ENS domain (`.eth` address)
   - AES-256-GCM encrypted private metadata (system prompts, API keys, skills, knowledge bases) anchored on-chain via content hashes
3. **Trade** the NFT — the ENS domain and encrypted skills transfer together; private metadata is re-encrypted for the new owner inside a compute node, verified on-chain by `TEEVerifier`. Alternatively, transfer the ENS domain directly and our relayer detects the transaction, automatically transferring agent ownership cross-chain.
4. **Accumulate reputation** via client feedback with Sybil-resistant scoring, visible to all via the shared ENS domain
5. **Request validation** from TEE oracles or staker re-execution via `ValidationRegistry`
6. **Decrypt skills** — only approved agents or the owner can decrypt and use the agent's encrypted data
7. **Run AI inference** through the 0G Compute Network (pay-per-request, OpenAI-compatible API) - Coming soon

---

## Repository Structure

```
open-agents-toolkit/
├── packages/
│   ├── core/          # Shared types, error classes, EIP-712 utilities, network config
│   ├── agent-nft/     # ERC-7857 client: metadata, decryption, ABIs, 0G Storage, server helpers
│   └── compute/       # 0G Storage and TEE re-encryption oracle
├── contracts/         # Solidity contracts (Hardhat 3 + viaIR)
│   ├── src/
│   │   ├── AgentRegistry.sol       # ERC-8004 + ERC-721 identity registry
│   │   ├── ReputationRegistry.sol  # Client feedback with Sybil-resistant scoring
│   │   ├── ValidationRegistry.sol  # TEE validation hooks
│   │   ├── ENSAgentRegistry.sol    # ENS-native registry w/ cross-chain ownership mirror
│   │   └── TEEVerifier.sol         # ECDSA attestation verifier for oracle proofs
│   ├── test/          # 60+ tests (node:test + viem)
│   └── ignition/      # Hardhat Ignition deployment modules
├── apps/
│   └── dashboard/     # Next.js 15 App Router — agent management UI
└── examples/
    └── langchain-agent/  # LangChain tool integration example
```

---

## Smart Contracts

All contracts are per-chain singletons. `ReputationRegistry`, `ValidationRegistry`, and `ENSAgentRegistry` are initialized with the `AgentRegistry` address after deployment.

| Contract             | Standard           | Description                                                                                                                                          |
| -------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentRegistry`      | ERC-8004 / ERC-721 | Core agent identity registry — mint agent NFT, store metadata URI on 0G Storage, register agent wallet with EIP-712 proof, on-chain metadata entries |
| `ReputationRegistry` | ERC-8004           | Fixed-point client feedback (int128 × 10^decimals), revocations, response URIs, `getSummary` with Sybil-resistant client filtering                   |
| `ValidationRegistry` | ERC-8004           | Request/response validation for TEE oracles, zkML provers, and staker re-execution; supports progressive finality                                    |
| `ENSAgentRegistry`   | —                  | ENS namehash-based identity with cross-chain ownership mirror via KeeperHub                                                                          |
| `TEEVerifier`        | ERC-7857           | ECDSA attestation verifier oracle signing keys                                                                                                       |

Contract ABIs are exported from `@open-agents-toolkit/agent-nft`:

```typescript
// Server-side
import {
  AGENT_REGISTRY_ABI,
  AGENT_NFT_ABI,
  REPUTATION_REGISTRY_ABI,
} from "@open-agents-toolkit/agent-nft";

// Browser / frontend (no Node.js deps)
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent-nft/browser";
```

---

## SDK

### `@open-agents-toolkit/core`

Shared types used by all packages. No runtime dependencies.

```typescript
import type {
  AgentIdentity,
  AgentRegistrationFile,
  AgentPrivateMetadata,
  AgentNFTRecord,
} from "@open-agents-toolkit/core";
import { NFTError, RegistryError } from "@open-agents-toolkit/core";
```

---

### `@open-agents-toolkit/agent-nft`

Read-only TypeScript client for ERC-7857 NFT metadata, registry/reputation/validation queries, AES-256-GCM encryption, 0G Storage, and server-side data preparation helpers.

#### `AgentNFTClient` — read encrypted NFT metadata

```typescript
import { AgentNFTClient } from "@open-agents-toolkit/agent-nft";

const client = new AgentNFTClient({ contractAddress: "0x...", publicClient });

// Fetch on-chain record
const record = await client.getRecord(tokenId);

// Decrypt private metadata (after receiving content key from TEE transfer)
client.provideContentKey(tokenId, aesContentKey);
const { systemPrompt, intelligentData } = await client.loadMetadata(tokenId);
```

#### `AgentRegistry` — read registry, reputation, and validation

```typescript
import { AgentRegistry } from "@open-agents-toolkit/agent-nft";

const registry = new AgentRegistry({
  agentRegistryAddress: "0x...",
  reputationRegistryAddress: "0x...",
  validationRegistryAddress: "0x...",
  publicClient,
});

// Resolve agent + fetch metadata from 0G Storage or HTTPS
const agent = await registry.resolve(agentId);
// → { agentId, owner, agentWallet, metadataUri, metadata: AgentRegistrationFile }

// Reputation
const entries = await registry.getAllFeedbacks(agentId);
const summary = await registry.getReputationSummary(agentId, clientAddresses);

// Validation
const status = await registry.getValidationStatus(requestHash);
```

#### Encryption utilities

```typescript
import {
  generateContentKey, // → 32-byte AES key
  encryptMetadata, // AES-256-GCM encrypt any JSON payload
  decryptMetadata, // decrypt an EncryptedBlob
  hashEncryptedBlob, // keccak256 commitment for on-chain anchoring
  decryptContentKey, // ECIES decrypt sealed content key
  uploadEncryptedIntelligentData, // encrypt + upload items to 0G Storage
  buildSecureTransferPayloads, // build TEE oracle request payload
  buildDecryptMessage, // build EIP-191 message for key request
  decryptEncryptedBlob, // full decrypt flow after TEE handoff
  parseAgentServicesJson, // validate/parse AgentService JSON
  buildAgentServiceTraits, // produce ERC-721 trait attributes
  readJsonFromUri, // fetch JSON from zerog:// or https://
} from "@open-agents-toolkit/agent-nft";
```

**Mint flow (frontend):**

1. Server action: `uploadEncryptedIntelligentData(blobs, zeroGOptions)` → `intelligentData[]` array
2. Frontend: `AgentNFT.mint(publicMetadataUri, intelligentData, verifierAddress, mintFee)` via viem

**Transfer flow:**

1. Server action: `buildSecureTransferPayloads(...)` → oracle request payload
2. `ZeroGComputeClient.requestReEncryption(...)` → `{ newDataHashes, sealedKey, proof }`
3. Frontend: `AgentNFT.secureTransfer(tokenId, newOwner, newDataHashes, sealedKey, proof)` via viem

**Decryption flow (new owner):**

1. Server action: `buildDecryptMessage(tokenId, owner)` → EIP-191 message
2. Oracle: `decryptEncryptedBlob(encryptedBlob, sealedKey, privateKey)` → plaintext

#### 0G Storage

```typescript
import {
  ZeroGStorageClient,
  readZeroGJSON,
  readZeroGBytes,
} from "@open-agents-toolkit/agent-nft";

const storage = new ZeroGStorageClient({
  privateKey: "0x...",
  network: "0gTestnet",
});
const metadata = await readZeroGJSON<AgentRegistrationFile>(
  "zerog://0x...",
  options,
);
```

---

### `@open-agents-toolkit/compute`

0G ai inference and re-encryption oracle.

#### AI inference

```typescript
import { ZeroGComputeClient } from "@open-agents-toolkit/compute";

const compute = new ZeroGComputeClient({
  privateKey: process.env.PRIVATE_KEY,
  network: "0gTestnet",
});
await compute.setup();

const { content } = await compute.inference({
  model: "llama-3.1-8b-instruct",
  messages: [{ role: "user", content: "Summarise this document..." }],
});
```

#### re-encryption oracle (ERC-7857 transfers)

```typescript
const { newDataHashes, sealedKey, proof } = await compute.requestReEncryption({
  tokenId,
  from: currentOwner,
  to: newOwner,
  contentKey: aesContentKey,
  newOwnerPublicKey: newOwnerPubKey,
  intelligentDataHashes: currentOnChainHashes,
});
// Frontend calls: AgentNFT.secureTransfer(tokenId, newOwner, newDataHashes, sealedKey, proof)
```

---

## Dashboard

The `apps/dashboard` Next.js 15 app is the primary UI.

- All contract writes are executed in the browser via viem `writeContract` — no backend proxy
- Server Actions (`/lib/actions/`) handle data preparation, encryption, and 0G Storage uploads only
- No API routes for internal use

**Key server actions:**

- `prepareCreateAgent` — upload metadata to 0G, return `intelligentData[]` for frontend mint call
- `prepareTransferAgent` — call Compute oracle, build `secureTransfer` payload
- `prepareUpdateServices` — re-encrypt and upload updated service metadata
- `getRegisteredAgents` / `getAgent` — read agent state from chain and 0G Storage
- `decryptAgentIntelligentData` — decrypt encrypted blobs after ownership transfer

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10

```bash
npm install
```

### Build packages

```bash
cd packages && npm run build
```

### Run contract tests

```bash
cd contracts && npm test
```

### Deploy contracts

**0G Galileo testnet** (Chain ID 16602):

```bash
# Tokens: https://faucet.0g.ai
npm run deploy:zeroG
```

**Sepolia:**

```bash
  npm run deploy:sepolia
```

### Register a TEE oracle

```bash
  npm run addOracle:zeroG
```

### Register a Keeper address that can act as a contract admin

```bash
  npm run setKeeper:zeroG
```

### Run the dashboard

```bash
cd apps/dashboard
cp .env.example .env
npm run dev


# Auto-populate contract addresses from latest deployment
cd ../../contracts
npm run setup-env
```

---

## Environment Variables

See `.env.example`

---

## Open Standards

- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Trustless Agent Registry (identity, reputation, validation)
- **[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857)** — Intelligent Digital Assets (ownable AI agents with encrypted private metadata)

---

## License

MIT — see [LICENSE](./LICENSE).
