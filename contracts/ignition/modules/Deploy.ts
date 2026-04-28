import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys all open-agents-toolkit contracts:
 *   - IdentityRegistry   (ERC-8004 identity)
 *   - ReputationRegistry (ERC-8004 reputation)
 *   - ValidationRegistry (ERC-8004 validation)
 *   - TEEVerifier        (ECDSA oracle verifier for ERC-7857 transfers)
 *                        Use a 0G Compute TDX node as the oracle — call
 *                        addOracle(<TDX_SIGNING_ADDRESS>) after deployment.
 *   - AgentNFT           (ERC-7857 agent NFT)
 *
 * Run:
 *   npm hardhat ignition deploy ignition/modules/Deploy.ts
 *   npm hardhat ignition deploy ignition/modules/Deploy.ts --network sepolia
 */
export default buildModule("OpenAgentsToolkit", (m) => {
  // ── ERC-8004 Registry contracts ────────────────────────────────────────────
  const identityRegistry = m.contract("IdentityRegistry");
  const reputationRegistry = m.contract("ReputationRegistry");
  const validationRegistry = m.contract("ValidationRegistry");

  // Wire up reputation and validation registries to the identity registry.
  m.call(reputationRegistry, "initialize", [identityRegistry], { id: "InitReputation" });
  m.call(validationRegistry, "initialize", [identityRegistry], { id: "InitValidation" });

  // ── ERC-7857 verifiers & NFT ───────────────────────────────────────────────
  // TEEVerifier: oracle must be a registered address (e.g. a 0G Compute TDX node).
  // After deployment, call teeVerifier.addOracle(<TDX_SIGNING_ADDRESS>).
  const teeVerifier = m.contract("TEEVerifier");

  const agentNFT = m.contract("AgentNFT", [0n]);

  return {
    identityRegistry,
    reputationRegistry,
    validationRegistry,
    teeVerifier,
    agentNFT,
  };
});
