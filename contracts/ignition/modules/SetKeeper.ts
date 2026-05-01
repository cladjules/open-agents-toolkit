import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployModule from "./Deploy.js";

/**
 * SetKeeper — Set the KeeperHub executor address on ENSAgentRegistry.
 *
 * Run after Deploy:
 *   npm run setKeeper:zeroG -- --parameters '{"SetKeeper":{"keeperAddress":"0x..."}}'
 */
export default buildModule("SetKeeper", (m) => {
  const { ensAgentRegistry } = m.useModule(DeployModule);

  const keeperAddress = m.getParameter("keeperAddress");

  m.call(ensAgentRegistry, "setKeeper", [keeperAddress], { id: "SetKeeperAddress" });

  return { ensAgentRegistry };
});
