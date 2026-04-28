import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toHex, zeroAddress } from 'viem';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.create();

describe('IdentityRegistry', function () {
  async function deployFixture() {
    const registry = await viem.deployContract('IdentityRegistry');
    const [alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    return { registry, alice, bob, publicClient };
  }

  it('register(string): mints token with correct owner and URI', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    const id = 1n;
    assert.equal((await registry.read.ownerOf([id])).toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(await registry.read.tokenURI([id]), 'zerog://0xAgent123');
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it('register(): mints token with no URI', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register({ account: alice.account });
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it('register(string,MetadataEntry[]): stores extra metadata', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xMetaHash', [{ metadataKey: 'foo', metadataValue: toHex('bar') }]], { account: alice.account });
    const id = 1n;
    assert.equal(await registry.read.getMetadata([id, 'foo']), toHex('bar'));
  });

  it('register: increments totalSupply', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xA'], { account: alice.account });
    await registry.write.register(['zerog://0xB'], { account: alice.account });
    assert.equal(await registry.read.totalSupply(), 2n);
  });

  it('register: agentWallet is initialised to owner', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([1n])).toLowerCase(), alice.account.address.toLowerCase());
  });

  it('setAgentURI: updates URI when called by owner', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xOldHash'], { account: alice.account });
    await registry.write.setAgentURI([1n, 'zerog://0xNewHash'], { account: alice.account });
    assert.equal(await registry.read.tokenURI([1n]), 'zerog://0xNewHash');
  });

  it('setAgentURI: reverts if caller is not owner', async function () {
    const { registry, alice, bob } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      registry.write.setAgentURI([1n, 'zerog://0xHacked'], { account: bob.account }),
      registry, 'NotTokenOwnerOrOperator',
    );
  });

  it('setMetadata: stores and retrieves arbitrary metadata', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xX'], { account: alice.account });
    await registry.write.setMetadata([1n, 'myKey', toHex('myValue')], { account: alice.account });
    assert.equal(await registry.read.getMetadata([1n, 'myKey']), toHex('myValue'));
  });

  it('setMetadata: reverts when setting reserved key agentWallet', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xX'], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      registry.write.setMetadata([1n, 'agentWallet', toHex('0x00')], { account: alice.account }),
      registry, 'ReservedKey',
    );
  });

  it('setAgentWallet: sets wallet with valid EIP-712 signature', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    const id = 1n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'IdentityRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: id, newWallet: bob.account.address, deadline },
    });
    await registry.write.setAgentWallet([id, bob.account.address, deadline, signature], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([id])).toLowerCase(), bob.account.address.toLowerCase());
  });

  it('setAgentWallet: reverts with expired deadline', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    const deadline = 1n;
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'IdentityRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 1n, newWallet: bob.account.address, deadline },
    });
    await viem.assertions.revertWithCustomError(
      registry.write.setAgentWallet([1n, bob.account.address, deadline, signature], { account: alice.account }),
      registry, 'SignatureExpired',
    );
  });

  it('setAgentWallet: reverts with wrong signer', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await alice.signTypedData({
      domain: { name: 'IdentityRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 1n, newWallet: bob.account.address, deadline },
    });
    await viem.assertions.revertWithCustomError(
      registry.write.setAgentWallet([1n, bob.account.address, deadline, signature], { account: alice.account }),
      registry, 'InvalidSignature',
    );
  });

  it('setAgentWallet: reverts if caller is not owner', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'IdentityRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 1n, newWallet: bob.account.address, deadline },
    });
    await viem.assertions.revertWithCustomError(
      registry.write.setAgentWallet([1n, bob.account.address, deadline, signature], { account: bob.account }),
      registry, 'NotTokenOwnerOrOperator',
    );
  });

  it('unsetAgentWallet: clears wallet to zero address', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    assert.notEqual((await registry.read.getAgentWallet([1n])), zeroAddress);
    await registry.write.unsetAgentWallet([1n], { account: alice.account });
    assert.equal(await registry.read.getAgentWallet([1n]), zeroAddress);
  });

  it('transfer: clears agentWallet automatically', async function () {
    const { registry, alice, bob } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.register(['zerog://0xAgent123'], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([1n])).toLowerCase(), alice.account.address.toLowerCase());
    await registry.write.transferFrom([alice.account.address, bob.account.address, 1n], { account: alice.account });
    assert.equal(await registry.read.getAgentWallet([1n]), zeroAddress);
  });
});
