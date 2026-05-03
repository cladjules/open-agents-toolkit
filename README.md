# Open Agents Toolkit

Create, own, and manage AI agents on-chain with verifiable identity, private encrypted data, and transparent reputation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

---

## What is it?

Open Agents Toolkit (OAT) is a full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent gets a permanent identity tied to an ENS domain, private encrypted data managed through a TEE oracle, verifiable reputation scored by other agents, and all files stored on 0G decentralized storage.

**Architecture:** The frontend (Next.js dashboard) owns all contract writes directly via viem. The SDK packages provide read-only clients, encryption/decryption utilities, and server-side helpers for data preparation and 0G Storage interactions.

---

## Core Pillars

### 1. On-Chain Agent Identity — EIP-712 + ENS

Every agent is minted as an **ERC-721 NFT** and linked to an **ENS domain** (`.eth`). The ENS name is the canonical, human-readable identity for the agent across all chains.

- Agent identity is derived from the ENS **namehash node** — no centralized registry needed
- Ownership is registered on-chain with an **EIP-712 typed-data proof**, ensuring the agent wallet signature is verifiable by anyone
- Transferring the ENS domain triggers an automatic cross-chain ownership mirror via KeeperHub — making ENS the single source of truth for agent ownership
- Agents are fully composable with existing NFT infrastructure (marketplaces, wallets, etc.)

### 2. Private Intelligent Data — ERC-7857 + TEE Oracle

Sensitive agent data — system prompts, agent definitions, API keys, knowledge bases — is stored as **Intelligent Data** per the [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) standard. All data is encrypted at rest on **0G Storage** and anchored on-chain via content hashes.

- Data is encrypted with **AES-256-GCM**, with sealed keys managed by a **TEE Oracle** (Intel TDX via 0G Compute)
- Only the current owner (or explicitly approved wallets) can decrypt and use the agent's private data
- **Approve** another wallet to access your agent's data without transferring ownership
- **Transfer** the NFT — private data is automatically re-encrypted for the new owner inside the TEE, verified on-chain by `TEEVerifier`. No plaintext ever leaves the secure enclave.

### 3. On-Chain Reputation & Services — ERC-8004

Agents earn a verifiable, tamper-proof reputation through the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) standard. Other agents and clients can submit scored feedback on-chain, building a trustless track record.

- **Reputation scores** are fixed-point values (int128 × 10^decimals) stored in `ReputationRegistry` with Sybil-resistant client filtering
- Define **service endpoints** directly on-chain: MCP, A2A, web, DID, email, and custom protocols
- Reputation and service definitions travel with the agent NFT — new owners inherit the agent's full history
- Query `getSummary` to get a filtered, weighted reputation score for any agent

### 4. Decentralized Encrypted Storage — 0G Storage

Every file, metadata blob, and encrypted payload is stored on **[0G Storage](https://0g.ai)** — a decentralized storage network. Nothing is stored on centralized servers.

- Public metadata (name, description, image, services) is uploaded as JSON to 0G Storage and referenced via `zerog://` URIs
- Private intelligent data (prompts, configs, keys) is AES-encrypted before upload; only the content hash is stored on-chain
- Files can be fetched from `zerog://` URIs in both server and browser environments via the SDK

---

## Full Lifecycle

1. **Register** — Attach an ENS domain and mint an ERC-721 NFT. Sign an EIP-712 proof to link the agent wallet on-chain.
2. **Encrypt & Upload** — Private data (prompts, config, API keys) is encrypted with AES-256-GCM and uploaded to 0G Storage. Content hashes are anchored on-chain.
3. **Define Services** — Publish MCP, A2A, web, and other endpoints on-chain so other agents and clients can discover and connect to your agent.
4. **Approve or Transfer** — Approve other wallets to access your agent's private data, or transfer the NFT entirely. On transfer, the TEE re-encrypts all private data for the new owner — verified on-chain.
5. **Earn Reputation** — Other agents and clients submit feedback scores on-chain. Reputation accumulates on the agent NFT and persists across ownership changes.
6. **Discover** — Browse all registered agents, filter by reputation, and connect via their published service endpoints.

---

## Repository Structure

```
open-agents-toolkit/
├── packages/
│   ├── core/          # Shared types, EIP-712 utilities, network config
│   ├── agent-nft/     # ERC-7857 client: metadata, encryption/decryption, ABIs, 0G Storage
│   └── compute/       # 0G Compute: TEE re-encryption oracle + AI inference
├── contracts/         # Solidity 0.8.35 (Hardhat + viaIR)
│   ├── src/
│   │   ├── AgentRegistry.sol       # ERC-8004 + ERC-721 — core agent NFT + identity
│   │   ├── ENSAgentRegistry.sol    # ENS-native registry + cross-chain ownership mirror
│   │   ├── ReputationRegistry.sol  # ERC-8004 feedback with Sybil-resistant scoring
│   │   ├── ValidationRegistry.sol  # TEE validation hooks
│   │   └── TEEVerifier.sol         # ECDSA attestation verifier for TEE oracle proofs
│   ├── test/          # Contract tests (node:test + viem)
│   └── ignition/      # Hardhat Ignition deployment modules
└── apps/
    └── dashboard/     # Next.js 15 App Router — agent management UI
```

---

## Smart Contracts

All contracts are per-chain singletons. `ReputationRegistry`, `ValidationRegistry`, and `ENSAgentRegistry` are initialized with the `AgentRegistry` address after deployment.

| Contract             | Standard           | Description                                                                                                                          |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AgentRegistry`      | ERC-8004 / ERC-721 | Core agent identity — mint NFT, store metadata URI on 0G Storage, register agent wallet with EIP-712 proof, on-chain service entries |
| `ENSAgentRegistry`   | ERC-721 / EIP-712  | ENS namehash-based identity with cross-chain ownership mirror via KeeperHub                                                          |
| `ReputationRegistry` | ERC-8004           | Fixed-point client feedback (int128 × 10^decimals), revocations, response URIs, `getSummary` with Sybil-resistant filtering          |
| `ValidationRegistry` | ERC-8004           | Request/response validation for TEE oracles, zkML provers, and staker re-execution                                                   |
| `TEEVerifier`        | ERC-7857           | ECDSA attestation verifier for TEE oracle signing keys                                                                               |

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

0G Compute integration for AI inference and TEE re-encryption oracle.

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

### 1. Install dependencies

```bash
npm install
cd packages && npm run build
```

### 2. Configure environment

```bash
cd apps/dashboard
cp .env.example .env
# Edit .env with your contract addresses, 0G RPC, and wallet key
```

Auto-populate contract addresses from a local deployment:

```bash
cd contracts
npm run setup-env
```

### 3. Run contract tests

```bash
cd contracts && npm test
```

### 4. Deploy contracts

**0G Galileo testnet** (Chain ID 16602, tokens: https://faucet.0g.ai):

```bash
npm run deploy:zeroG
```

**Sepolia:**

```bash
npm run deploy:sepolia
```

### 5. Register a TEE oracle signing key

```bash
npm run addOracle:zeroG
```

### 6. Set a KeeperHub address for cross-chain ENS ownership mirroring

```bash
npm run setKeeper:zeroG
```

### 7. Start the dashboard

```bash
cd apps/dashboard && npm run dev
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
