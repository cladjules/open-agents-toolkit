import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys all open-agents-toolkit contracts:
 *   - AgentRegistry      (ERC-8004 identity + ERC-7857 agent NFT — unified)
 *   - ReputationRegistry (ERC-8004 reputation)
 *   - ValidationRegistry (ERC-8004 validation)
 *   - TEEVerifier        (ECDSA oracle verifier for ERC-7857 secure transfers)
 *   - ENSAgentRegistry   (owner-managed ENS mirror + relay coordinator)
 *
 * Run:
 *   npm run deploy:zeroG
 *
 * To register a TEE oracle after deploy:
 *   npm run addOracle:zeroG 
 */
export default buildModule("OpenAgentsToolkit", (m) => {
  const deployer = m.getAccount(0);

  // ── ERC-7857 verifier ──────────────────────────────────────────────────────
  const teeVerifier = m.contract("TEEVerifier");

  // ── ERC-8004 + ERC-7857 unified registry ──────────────────────────────────
  const agentRegistry = m.contract("AgentRegistry", [
    "Open Agents Toolkit",
    "OAT",
    deployer,
    teeVerifier,
  ]);
  const reputationRegistry = m.contract("ReputationRegistry", [agentRegistry]);
  const validationRegistry = m.contract("ValidationRegistry", [agentRegistry]);
  const ensAgentRegistry = m.contract("ENSAgentRegistry", [agentRegistry]);

  // Allow ENSAgentRegistry to call AgentRegistry.secureTransfer() as trusted relayer.
  m.call(agentRegistry, "setRelayer", [ensAgentRegistry, true], {
    id: "AuthorizeENSAgentRegistryRelayer",
  });

  return {
    agentRegistry,
    ensAgentRegistry,
    reputationRegistry,
    validationRegistry,
    teeVerifier,
  };
});
