import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, encodePacked, toBytes, toHex } from "viem";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();

describe("TEEVerifier", function () {
  async function deployFixture() {
    const verifier = await viem.deployContract("TEEVerifier");
    const nft = await viem.deployContract("AgentRegistry");
    const [owner, oracle, bob] = await viem.getWalletClients();
    return { verifier, nft, owner, oracle, bob };
  }

  it("addOracle: registers an oracle address (owner only)", async function () {
    const { verifier, oracle, owner } = await networkHelpers.loadFixture(deployFixture);
    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    // No revert = success; we verify via verifyReEncryption below
  });

  it("addOracle: reverts if called by non-owner", async function () {
    const { verifier, oracle, bob } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      verifier.write.addOracle([oracle.account.address], { account: bob.account }),
      verifier,
      "OwnableUnauthorizedAccount",
    );
  });

  it("removeOracle: de-registers oracle so proofs are rejected", async function () {
    const { verifier, nft, oracle, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    // Register oracle, mint, register it, then remove it — transfer should fail.
    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", keccak256(toHex("enc")), verifier.address],
      { account: owner.account },
    );

    // Build a valid proof then remove oracle before calling secureTransfer.
    const tokenId = 1n;
    const encDataHash = await nft.read.getEncryptedDataHash([tokenId]);
    const newDataHash = keccak256(encodePacked(["string"], ["new-enc"]));
    const msgHash = keccak256(
      encodePacked(
        ["uint256", "address", "address", "bytes32", "bytes32"],
        [tokenId, owner.account.address, bob.account.address, encDataHash, newDataHash],
      ),
    );

    const proof = await oracle.signMessage({ message: { raw: toBytes(msgHash) } });

    // Remove oracle — proof must now be rejected.
    await verifier.write.removeOracle([oracle.account.address], { account: owner.account });

    await viem.assertions.revertWithCustomError(
      nft.write.secureTransfer([tokenId, bob.account.address, newDataHash, "0x", proof], {
        account: owner.account,
      }),
      nft,
      "VerificationFailed",
    );
  });

  it("verifyReEncryption: returns true for valid oracle signature", async function () {
    const { verifier, nft, oracle, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", keccak256(toHex("enc")), verifier.address],
      { account: owner.account },
    );

    const tokenId = 1n;
    const encDataHash = await nft.read.getEncryptedDataHash([tokenId]);
    const newDataHash = keccak256(encodePacked(["string"], ["new-enc"]));

    // Reproduce on-chain hash: keccak256(abi.encodePacked(tokenId, from, to, oldDataHash, newDataHash))
    const msgHash = keccak256(
      encodePacked(
        ["uint256", "address", "address", "bytes32", "bytes32"],
        [tokenId, owner.account.address, bob.account.address, encDataHash, newDataHash],
      ),
    );

    // Sign with personal_sign (EIP-191 prefix applied by signMessage)
    const proof = await oracle.signMessage({ message: { raw: toBytes(msgHash) } });

    // secureTransfer uses verifyReEncryption internally — no revert = valid
    await nft.write.secureTransfer([tokenId, bob.account.address, newDataHash, "0x", proof], {
      account: owner.account,
    });

    assert.equal(
      (await nft.read.ownerOf([tokenId])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
  });

  it("verifyReEncryption: rejects proof from unregistered signer", async function () {
    const { verifier, nft, oracle, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    // oracle is NOT registered
    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", keccak256(toHex("enc")), verifier.address],
      { account: owner.account },
    );

    const tokenId = 1n;
    const encDataHash = await nft.read.getEncryptedDataHash([tokenId]);
    const newDataHash = keccak256(encodePacked(["string"], ["new-enc"]));
    const msgHash = keccak256(
      encodePacked(
        ["uint256", "address", "address", "bytes32", "bytes32"],
        [tokenId, owner.account.address, bob.account.address, encDataHash, newDataHash],
      ),
    );
    const proof = await oracle.signMessage({ message: { raw: toBytes(msgHash) } });

    await viem.assertions.revertWithCustomError(
      nft.write.secureTransfer([tokenId, bob.account.address, newDataHash, "0x", proof], {
        account: owner.account,
      }),
      nft,
      "VerificationFailed",
    );
  });

  it("verifyReEncryption: reverts on invalid proof length", async function () {
    const { verifier, nft, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", keccak256(toHex("enc")), verifier.address],
      { account: owner.account },
    );

    // InvalidProofLength is thrown by TEEVerifier and bubbles through AgentNFT
    await viem.assertions.revertWithCustomError(
      nft.write.secureTransfer([1n, bob.account.address, keccak256(toHex("x")), "0x", toHex("short")], {
        account: owner.account,
      }),
      verifier,
      "InvalidProofLength",
    );
  });
});
