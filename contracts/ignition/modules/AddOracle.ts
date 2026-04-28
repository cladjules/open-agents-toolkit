import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * AddOracle — Register a 0G Compute TDX node's ECDSA signing address with TEEVerifier.
 *
 * Run after the main Deploy module:
 *
 *   TEE_VERIFIER_ADDRESS=0x... TDX_ORACLE_ADDRESS=0x... \
 *     npx hardhat ignition deploy ignition/modules/AddOracle.ts --network sepolia
 *
 * The TDX_ORACLE_ADDRESS is the ECDSA address derivable from a 0G Compute provider's
 * attestation report. Discover providers with ZeroGComputeClient.listServices().
 */
export default buildModule("AddOracle", (m) => {
  const verifierAddress = m.getParameter<string>(
    "teeVerifierAddress",
    process.env.TEE_VERIFIER_ADDRESS ?? "",
  );
  const oracleAddress = m.getParameter<string>(
    "oracleAddress",
    process.env.TDX_ORACLE_ADDRESS ?? "",
  );

  const teeVerifier = m.contractAt("TEEVerifier", verifierAddress as `0x${string}`);
  m.call(teeVerifier, "addOracle", [oracleAddress], { id: "RegisterOracle" });

  return { teeVerifier };
});
