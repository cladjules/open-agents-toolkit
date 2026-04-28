import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toHex, zeroAddress } from "viem";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();

const ENCRYPTED_HASH = keccak256(toHex("encryptedData"));
const PUBLIC_URI = "zerog://0xPublicMetaHash";

describe("AgentNFT", function () {
  async function deployFixture() {
    const nft = await viem.deployContract("AgentNFT", [0n]);
    const passVerifier = await viem.deployContract("AlwaysPassVerifier");
    const failVerifier = await viem.deployContract("AlwaysFailVerifier");
    const [alice, bob] = await viem.getWalletClients();
    return { nft, passVerifier, failVerifier, alice, bob };
  }

  it("mint: creates token with correct owner, URI, hash, and verifier", async function () {
    const { nft, passVerifier, alice } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, passVerifier.address],
      { account: alice.account },
    );


    assert.equal((await nft.read.ownerOf([1n])).toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(await nft.read.tokenURI([1n]), PUBLIC_URI);
    assert.equal(await nft.read.getEncryptedDataHash([1n]), ENCRYPTED_HASH);
    assert.equal(
      (await nft.read.getVerifier([1n])).toLowerCase(),
      passVerifier.address.toLowerCase(),
    );
  });

  it("mint: reverts on empty URI", async function () {
    const { nft, passVerifier, alice } = await networkHelpers.loadFixture(deployFixture);

    await viem.assertions.revertWithCustomError(
      nft.write.mint([alice.account.address, "", ENCRYPTED_HASH, passVerifier.address], {
        account: alice.account,
      }),
      nft,
      "EmptyURI",
    );
  });

  it("mint: reverts on zero hash", async function () {
    const { nft, passVerifier, alice } = await networkHelpers.loadFixture(deployFixture);

    await viem.assertions.revertWithCustomError(
      nft.write.mint(
        [alice.account.address, PUBLIC_URI, `0x${"00".repeat(32)}`, passVerifier.address],
        {
          account: alice.account,
        },
      ),
      nft,
      "EmptyHash",
    );
  });

  it("mint: reverts on zero verifier address", async function () {
    const { nft, alice } = await networkHelpers.loadFixture(deployFixture);

    await viem.assertions.revertWithCustomError(
      nft.write.mint([alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, zeroAddress], {
        account: alice.account,
      }),
      nft,
      "InvalidVerifier",
    );
  });

  it("secureTransfer: transfers token when pass verifier approves", async function () {
    const { nft, passVerifier, alice, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, passVerifier.address],
      { account: alice.account },
    );

    await nft.write.secureTransfer([1n, bob.account.address, toHex("proof")], {
      account: alice.account,
    });

    assert.equal((await nft.read.ownerOf([1n])).toLowerCase(), bob.account.address.toLowerCase());
  });

  it("secureTransfer: reverts when fail verifier rejects proof", async function () {
    const { nft, failVerifier, alice, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, failVerifier.address],
      { account: alice.account },
    );

    await viem.assertions.revertWithCustomError(
      nft.write.secureTransfer([1n, bob.account.address, toHex("bad-proof")], {
        account: alice.account,
      }),
      nft,
      "VerificationFailed",
    );
  });

  it("secureTransfer: reverts if caller is not owner", async function () {
    const { nft, passVerifier, alice, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, passVerifier.address],
      { account: alice.account },
    );

    await viem.assertions.revertWithCustomError(
      nft.write.secureTransfer([1n, bob.account.address, toHex("proof")], {
        account: bob.account,
      }),
      nft,
      "NotTokenOwner",
    );
  });

  it("updateEncryptedData: updates hash when called by owner", async function () {
    const { nft, passVerifier, alice } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, passVerifier.address],
      { account: alice.account },
    );

    const newHash = keccak256(toHex("newEncryptedData"));
    await nft.write.updateEncryptedData([1n, newHash], { account: alice.account });

    assert.equal(await nft.read.getEncryptedDataHash([1n]), newHash);
  });

  it("updateEncryptedData: reverts if caller is not owner", async function () {
    const { nft, passVerifier, alice, bob } = await networkHelpers.loadFixture(deployFixture);

    await nft.write.mint(
      [alice.account.address, PUBLIC_URI, ENCRYPTED_HASH, passVerifier.address],
      { account: alice.account },
    );

    const hackHash = keccak256(toHex("hack"));
    await viem.assertions.revertWithCustomError(
      nft.write.updateEncryptedData([1n, hackHash], { account: bob.account }),
      nft,
      "NotTokenOwner",
    );
  });
});
