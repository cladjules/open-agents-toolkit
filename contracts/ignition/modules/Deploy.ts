import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Deploys all open-agents-toolkit contracts:
 *   - AgentNFT           (ERC-7857 agent NFT)
 *
 * Run:
 *   npm hardhat ignition deploy ignition/modules/Deploy.ts
 *   npm hardhat ignition deploy ignition/modules/Deploy.ts --network sepolia
 */
export default buildModule("OpenAgentsToolkit", (m) => {
  const agentNFT = m.contract("AgentNFT", [0n]);

  return {
    agentNFT,
  };
});
