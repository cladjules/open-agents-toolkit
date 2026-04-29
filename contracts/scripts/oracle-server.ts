/**
 * Local TEE oracle server — development / testing only.
 *
 * Simulates the re-encryption oracle that would run inside a 0G Compute TDX enclave.
 * Signs re-encryption proofs with a local ECDSA key instead of a TDX enclave key.
 *
 * Usage:
 *   1. npm run oracle:start           — starts on http://localhost:3100
 *   2. Register its signing address:  npm run addOracle:zeroG
 *   3. Run e2e:                       npm run e2e:zeroG
 *
 * Requires in .env:
 *   ORACLE_PRIVATE_KEY   — private key whose address you registered with addOracle()
 * Optional:
 *   ORACLE_PORT          — defaults to 3100
 */
import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { keccak256, encodePacked, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY as `0x${string}`;
if (!ORACLE_PRIVATE_KEY) throw new Error("ORACLE_PRIVATE_KEY not set in .env");

const oracle = privateKeyToAccount(ORACLE_PRIVATE_KEY);

console.log(`Oracle address: ${oracle.address}`);
console.log(`Register it:    npm run addOracle:zeroG`);
console.log();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST" || req.url !== "/reencrypt") {
    res.writeHead(404).end();
    return;
  }

  try {
    const body = JSON.parse(await readBody(req)) as {
      tokenId: string;
      from: `0x${string}`;
      to: `0x${string}`;
      encryptedDataHash: `0x${string}`;
      newOwnerPublicKey: `0x${string}`;
      contentKey: string; // base64
    };

    // Re-encrypt: in production this would be ECIES. Here we just hash it.
    const contentKeyBytes = Buffer.from(body.contentKey, "base64");
    const newOwnerPubBytes = toBytes(body.newOwnerPublicKey);
    const reEncryptedBlob = Buffer.concat([newOwnerPubBytes, contentKeyBytes]);
    const newDataHash = keccak256(reEncryptedBlob);
    const sealedKey = `0x${reEncryptedBlob.toString("hex")}` as `0x${string}`;

    // Sign keccak256(tokenId, from, to, oldDataHash, newDataHash) with EIP-191
    const innerHash = keccak256(
      encodePacked(
        ["uint256", "address", "address", "bytes32", "bytes32"],
        [BigInt(body.tokenId), body.from, body.to, body.encryptedDataHash, newDataHash],
      ),
    );
    const signature = await oracle.signMessage({ message: { raw: toBytes(innerHash) } });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ newDataHash, sealedKey, signature }));

    console.log(`✔ Signed re-encryption for token ${body.tokenId} → ${body.to}`);
  } catch (err) {
    console.error(err);
    res.writeHead(400).end(String(err));
  }
});

server.listen(3001, () => {
  console.log(`Oracle server listening on http://localhost:3001/reencrypt`);
});
