import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys all open-agents-toolkit contracts:
 *   - AgentRegistry      (ERC-8004 identity + ERC-7857 agent NFT — unified)
 *   - ReputationRegistry (ERC-8004 reputation)
 *   - ValidationRegistry (ERC-8004 validation)
 *   - TEEVerifier        (ECDSA oracle verifier for ERC-7857 secure transfers)
 *
 * Run:
 *   npm run deploy:zeroG
 *
 * To register a TEE oracle after deploy:
 *   npm run addOracle:zeroG 
 */
export default buildModule("OpenAgentsToolkit", (m) => {
  // ── ERC-8004 + ERC-7857 unified registry ──────────────────────────────────
  const agentRegistry = m.contract("AgentRegistry");
  const reputationRegistry = m.contract("ReputationRegistry");
  const validationRegistry = m.contract("ValidationRegistry");

  m.call(reputationRegistry, "initialize", [agentRegistry], { id: "InitReputation" });
  m.call(validationRegistry, "initialize", [agentRegistry], { id: "InitValidation" });

  // ── ERC-7857 verifier ──────────────────────────────────────────────────────
  const teeVerifier = m.contract("TEEVerifier");

  return {
    agentRegistry,
    reputationRegistry,
    validationRegistry,
    teeVerifier,
  };
});
