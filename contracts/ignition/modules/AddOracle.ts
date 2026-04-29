import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DeployModule from "./Deploy.js";

/**
 * AddOracle — Register a 0G Compute TDX node's ECDSA signing address with TEEVerifier.
 *
 * Ignition resolves the TEEVerifier address automatically from the prior Deploy run.
 *
 * Run after Deploy:
 *   npm run addOracle:zeroG -- --parameters '{"oracleAddress":"0x..."}'
 */
export default buildModule("AddOracle", (m) => {
  const { teeVerifier } = m.useModule(DeployModule);

  const oracleAddress = m.getParameter("oracleAddress");

  // contractAt narrows the type to ContractDeploymentFuture, which m.call requires.
  m.call(teeVerifier, "addOracle", [oracleAddress], { id: "RegisterOracle" });

  return { teeVerifier };
});
