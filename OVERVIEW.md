# Open Agents Toolkit — Project Overview

## The Problem

AI agents are proliferating fast. Dozens can already browse the web, write code, book meetings, and manage files on your behalf. But today there is no reliable way to answer a simple question: **can I trust this agent?**

When an agent introduces itself, you have no way to verify:
- Who owns it or is legally responsible for it
- Whether it is the same agent you spoke to last time
- What clients have already used it and what they experienced
- Whether it has been independently tested for safety or accuracy

The result is a fragmented ecosystem where agents are isolated black boxes, reputation is locked inside a single platform, and users must blindly extend trust to every new agent they encounter.

---

## What Open Agents Toolkit Does

Open Agents Toolkit (OAT) is a set of open standards and developer tools that lets any AI agent carry a **verifiable on-chain identity** — similar to how websites carry TLS certificates, but for agents.

With OAT an agent can:

1. **Prove it exists** — a permanent on-chain record holds its name, endpoints, capabilities, and owner.
2. **Prove it is itself** — every request the agent sends is cryptographically signed, so the receiver knows exactly which agent sent it.
3. **Be judged on its track record** — clients leave signed, tamper-proof feedback stored permanently on-chain. No single company controls the data.
4. **Be independently verified** — auditors, trusted-execution environments, and zero-knowledge proof systems can publish signed attestations about the agent's security and behavior.
5. **Be owned as a digital asset** — agents can be minted as NFTs, sold, transferred, or licensed, with private configuration (system prompts, character definitions) sealed and protected.

---

## How It Works in Practice

### Registering an agent

A developer builds an agent and calls `register()` on the Identity Registry. The contract mints a unique on-chain identity NFT and records the agent's public profile (name, description, service endpoints). The profile itself is stored on IPFS via **0G Storage**, a decentralized data layer that ensures the profile survives even if the developer stops paying a hosting bill.

Agents can also be given a **human-readable name** through ENS (Ethereum Name Service). An ENS name like `myagent.eth` can be listed as one of the agent's service endpoints in its profile, making discovery as simple as looking up a domain name.

### Building trust over time

Every time a client works with an agent, it can leave signed feedback — a numeric score, tags, and a short description. This feedback is stored on-chain in the Reputation Registry and is permanently associated with both the client's wallet and the agent's identity. No one can delete it, and the agent owner cannot manufacture fake reviews because feedback is gated by on-chain identity verification.

### Independent validation

For higher-stakes use cases (financial agents, medical agents, code deployment agents), teams can trigger an independent validation. A validation request is published on-chain specifying which auditor should verify the agent. The auditor — which could be a trusted hardware enclave (TEE), a math-based proof system (zkML), or a group of stakers — publishes its findings on-chain as a signed response.

**KeeperHub** plugs directly into this workflow. KeeperHub is an automation network that can watch for new `ValidationRequest` events on-chain and automatically dispatch validation jobs to the appropriate auditor, then post the response back on-chain — no human in the loop required.

### Owning an agent as an NFT

Agents can be minted as ownable NFTs (ERC-7857). The owner holds a token that represents full control of the agent, including its private configuration. That configuration is encrypted and its integrity is sealed on-chain — so when an agent NFT is sold or transferred, the buyer can be confident the private data was handed over correctly (and the seller can no longer access it). Agents can also be cloned and licensed, opening up a marketplace for reusable AI agent designs.

Because `AgentNFT` is a standard ERC-721 token, it is **natively tradeable on OpenSea, Blur, LooksRare, and any ERC-721 marketplace** without any modification. Each agent NFT carries standard metadata — `name`, `description`, `image`, and `attributes` — so it displays correctly in wallets and marketplace UIs out of the box. The image or avatar for an agent can be any IPFS or 0G URL.

The agent's encrypted private configuration (system prompt, character file, model weights) is stored off-chain on **0G Storage** as a large binary blob. Only its keccak256 hash is anchored on-chain. This means the private data is always available and tamper-proof, but never exposed on a public blockchain. When the NFT is transferred, a re-encryption proof lets the new owner decrypt the data while revoking the previous owner's access — with no trusted intermediary.

---

## Who It Is For

| Audience | What OAT solves |
|---|---|
| **AI agent developers** | Publish once to an open directory; get discovered by any app or user without integrating with a proprietary platform |
| **Application builders** | Look up agents by identity, filter by verified reputation and attestations, without trusting any single vendor |
| **Enterprises** | Audit and validate agents before deployment; track a permanent on-chain record of every agent used |
| **Agent marketplaces** | Buy, sell, and license agent NFTs with provable ownership and protected intellectual property |

---

## Key Integrations

### 0G Storage — Decentralized Data Backbone

Agent profiles and encrypted metadata are stored on [0G](https://0g.ai), a decentralized storage and data availability network. This means:
- Agent profiles are **permanently available** without any central server
- Encrypted private metadata (system prompts, character files) is stored off-chain but its hash is anchored on-chain — nobody can alter it without detection
- Large AI model weights or datasets associated with an agent can be stored cost-efficiently

### ENS — Human-Readable Agent Names

Agents can be given names through the [Ethereum Name Service](https://ens.domains). An agent's ENS name (e.g. `helpful-assistant.eth`) can be listed as a discoverable endpoint in its on-chain registration profile. This makes agents as easy to find and remember as a website.

### KeeperHub — Automated Validation

[KeeperHub](https://keeperhub.dev) is a decentralized automation network. OAT emits on-chain events when validation is requested. KeeperHub keepers listen for these events and automatically:
1. Dispatch the validation job to the designated auditor
2. Submit the auditor's response back on-chain
3. Trigger any downstream workflows (e.g., updating an agent's trust badge in a frontend)

This creates a fully automated trust pipeline — from validation request to on-chain attestation — with no manual steps.

---

## Open Standards

OAT is built on published Ethereum Improvement Proposals so any tool or team can implement it independently:

- **ERC-8004** — Trustless Agent Registry. Defines the three-registry system (Identity, Reputation, Validation) and the JSON registration file format.
- **ERC-7857** — Intelligent Digital Assets. Defines ownable AI agents with encrypted private data stored on 0G, re-encryption on transfer, cloning, and usage authorization. Agents are standard ERC-721 tokens — tradeable on any NFT marketplace.
- **ERC-8128** — HTTP Message Signatures with Ethereum. Every outbound agent request is signed with the agent's Ethereum key using RFC 9421 HTTP Message Signatures. The receiving server verifies the `Signature` and `Signature-Input` headers to authenticate the caller without any off-chain trust.
- **EIP-712** — Typed structured data signing, used to prove agent wallet ownership and authenticate every outbound request.
- **EIP-6963** — Multi-wallet discovery standard for browser environments.

---

## Project Structure at a Glance

```
On-chain (Solidity contracts)
    IdentityRegistry    — who is this agent?
    ReputationRegistry  — how has it performed?
    ValidationRegistry  — has it been audited?
    AgentNFT            — who owns it?

Off-chain (TypeScript SDK)
    ows                 — connect any wallet, sign any request
    signed-requests     — every agent call is ERC-8128 signed (RFC 9421 HTTP Message Signatures)
    registry            — read & write all three registries
    agent-nft           — mint, transfer, clone agent NFTs

Tooling
    dashboard           — web UI to browse and manage agents
    examples            — runnable end-to-end code examples
```

---

## License

Open Agents Toolkit is released under the MIT License.
