import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, keccak256, toBytes, toHex, zeroAddress } from "viem";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();

describe("TEEVerifier", function () {
  async function buildTransferProofBytes(params: {
    oldDataHash: `0x${string}`;
    newDataHash: `0x${string}`;
    recipient: { signMessage: (args: { message: { raw: Uint8Array } }) => Promise<`0x${string}`> };
    oracle: { signMessage: (args: { message: { raw: Uint8Array } }) => Promise<`0x${string}`> };
  }): Promise<`0x${string}`> {
    const accessNonce = toHex("access-nonce-1");
    const ownershipNonce = toHex("ownership-nonce-1");
    const encryptedPubKey = toHex("recipient-pubkey");
    const sealedKey = toHex("sealed-key");

    const accessInnerHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes" },
          { type: "bytes" },
        ],
        [params.oldDataHash, params.newDataHash, encryptedPubKey, accessNonce],
      ),
    );
    const accessProof = await params.recipient.signMessage({ message: { raw: toBytes(accessInnerHash) } });

    const ownershipInnerHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes" },
          { type: "bytes" },
          { type: "bytes" },
        ],
        [params.oldDataHash, params.newDataHash, sealedKey, encryptedPubKey, ownershipNonce],
      ),
    );
    const ownershipProof = await params.oracle.signMessage({ message: { raw: toBytes(ownershipInnerHash) } });

    return encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            {
              name: "accessProof",
              type: "tuple",
              components: [
                { name: "oldDataHash", type: "bytes32" },
                { name: "newDataHash", type: "bytes32" },
                { name: "nonce", type: "bytes" },
                { name: "encryptedPubKey", type: "bytes" },
                { name: "proof", type: "bytes" },
              ],
            },
            {
              name: "ownershipProof",
              type: "tuple",
              components: [
                { name: "oracleType", type: "uint8" },
                { name: "oldDataHash", type: "bytes32" },
                { name: "newDataHash", type: "bytes32" },
                { name: "sealedKey", type: "bytes" },
                { name: "encryptedPubKey", type: "bytes" },
                { name: "nonce", type: "bytes" },
                { name: "proof", type: "bytes" },
              ],
            },
          ],
        },
      ],
      [[
        {
          accessProof: {
            oldDataHash: params.oldDataHash,
            newDataHash: params.newDataHash,
            nonce: accessNonce,
            encryptedPubKey,
            proof: accessProof,
          },
          ownershipProof: {
            oracleType: 0,
            oldDataHash: params.oldDataHash,
            newDataHash: params.newDataHash,
            sealedKey,
            encryptedPubKey,
            nonce: ownershipNonce,
            proof: ownershipProof,
          },
        },
      ]],
    );
  }

  async function deployFixture() {
    const [owner, oracle, bob] = await viem.getWalletClients();
    const verifier = await viem.deployContract("TEEVerifier");
    const nft = await viem.deployContract("AgentRegistry", [
      "AgentRegistry",
      "AGENT",
      owner.account.address,
      verifier.address,
    ]);
    return { verifier, nft, owner, oracle, bob };
  }

  it("addOracle: registers an oracle address (owner only)", async function () {
    const { verifier, oracle, owner } = await networkHelpers.loadFixture(deployFixture);
    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    // No revert = success; we verify via verifySignature below
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

    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", "zerog://0xMeta1", []],
      { account: owner.account },
    );

    const tokenId = 0n;
    const oldDataHashes = [keccak256(toHex("enc"))];
    const newDataHashes = [keccak256(toHex("new-enc"))];
    await nft.write.updateIntelligentData(
      [tokenId, [{ dataDescription: "weights", dataHash: oldDataHashes[0] }]],
      { account: owner.account },
    );
    const proof = await buildTransferProofBytes({
      oldDataHash: oldDataHashes[0],
      newDataHash: newDataHashes[0],
      recipient: bob,
      oracle,
    });

    await verifier.write.removeOracle([oracle.account.address], { account: owner.account });

    await assert.rejects(
      nft.write.secureTransfer([tokenId, bob.account.address, newDataHashes, "0x", proof], {
        account: owner.account,
      }),
      /Invalid ownership proof/,
    );
  });

  it("secureTransfer: accepts valid TransferValidityProof[]", async function () {
    const { verifier, nft, oracle, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    await verifier.write.addOracle([oracle.account.address], { account: owner.account });
    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", "zerog://0xMeta2", []],
      { account: owner.account },
    );

    const tokenId = 0n;
    const oldDataHashes = [keccak256(toHex("enc"))];
    const newDataHashes = [keccak256(toHex("new-enc"))];
    await nft.write.updateIntelligentData(
      [tokenId, [{ dataDescription: "weights", dataHash: oldDataHashes[0] }]],
      { account: owner.account },
    );

    const proof = await buildTransferProofBytes({
      oldDataHash: oldDataHashes[0],
      newDataHash: newDataHashes[0],
      recipient: bob,
      oracle,
    });

    await nft.write.secureTransfer([tokenId, bob.account.address, newDataHashes, "0x", proof], {
      account: owner.account,
    });

    assert.equal(
      (await nft.read.ownerOf([tokenId])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
  });

  it("secureTransfer: rejects proof from unregistered oracle", async function () {
    const { verifier, nft, oracle, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", "zerog://0xMeta3", []],
      { account: owner.account },
    );

    const tokenId = 0n;
    const oldDataHashes = [keccak256(toHex("enc"))];
    const newDataHashes = [keccak256(toHex("new-enc"))];
    await nft.write.updateIntelligentData(
      [tokenId, [{ dataDescription: "weights", dataHash: oldDataHashes[0] }]],
      { account: owner.account },
    );
    const proof = await buildTransferProofBytes({
      oldDataHash: oldDataHashes[0],
      newDataHash: newDataHashes[0],
      recipient: bob,
      oracle,
    });

    await assert.rejects(
      nft.write.secureTransfer([tokenId, bob.account.address, newDataHashes, "0x", proof], {
        account: owner.account,
      }),
      /Invalid ownership proof/,
    );
  });

  it("secureTransfer: rejects non-encoded legacy-style proof bytes", async function () {
    const { verifier, nft, owner, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [owner.account.address, "zerog://0xPublic", "zerog://0xMeta4", []],
      { account: owner.account },
    );
    await nft.write.updateIntelligentData(
      [0n, [{ dataDescription: "weights", dataHash: keccak256(toHex("enc")) }]],
      { account: owner.account },
    );

    await assert.rejects(
      nft.write.secureTransfer([0n, bob.account.address, [keccak256(toHex("x"))], "0x", toHex("short")], {
        account: owner.account,
      }),
      /decode|revert/i,
    );
  });
});
