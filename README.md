# Open Agents Toolkit

A TypeScript SDK + CLI that gives any AI agent framework (LangChain, CrewAI, AutoGen, etc.) full Web3 awareness through four integrated modules.

---

## Repository Structure

```
open-agents-toolkit/
│   ├── src/
│   │   ├── AgentNFT.sol
│   ├── test/
│   └── ignition/modules/Deploy.ts
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10

### Install

```bash
npm install
```

### Run tests

```bash
# All packages + contracts
npm test

# Contracts only
cd contracts && npm test
```

### Deploy contracts (local Hardhat node)

```bash
# Terminal 1: start local node
cd contracts && npx hardhat node

# Terminal 2: deploy via Ignition
cd contracts
npx hardhat ignition deploy ignition/modules/Deploy.ts --network localhost
```

## Smart Contracts

| Contract   | Description                                                                             |
| ---------- | --------------------------------------------------------------------------------------- |
| `AgentNFT` | ERC-7857 Agent NFT — minting, secure transfer, cloning, usage authorization, delegation |

### IERC7857 — Unified Interface

`IERC7857` merges the core ERC-7857 spec, the usage-authorization extension, and the cloning extension into a single interface (following the 0g AgenticID reference).

| Group         | Functions / Events                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Minting       | `mint`, `iMint` (payable, mintFee-gated)                                                                                      |
| Transfers     | `secureTransfer` (raw proof), `iTransferFrom` (structured `TransferValidityProof`)                                            |
| Cloning       | `iCloneFrom` — duplicate IntelligentData to a new token                                                                       |
| Data          | `updateEncryptedData`, `getEncryptedDataHash`, `getVerifier`, `getIntelligentDatas`                                           |
| Authorization | `authorizeUsage`, `revokeAuthorization`, `batchAuthorizeUsage`, `isAuthorizedUser`, `authorizedUsersOf`, `authorizedTokensOf` |
| Delegation    | `delegateAccess`, `revokeDelegateAccess`                                                                                      |

### AgentNFT

Implements `IERC7857` and inherits `ERC721URIStorage`, `AccessControl`, `Pausable`, `ReentrancyGuard`.

| Feature            | Detail                                               |
| ------------------ | ---------------------------------------------------- |
| Roles              | `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `OPERATOR_ROLE` |
| Constructor        | `constructor(uint256 _mintFee)`                      |
| Max authorizations | 100 users per token                                  |
| Admin              | `setMintFee`, `pause` / `unpause`, `withdraw`        |
