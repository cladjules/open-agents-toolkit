import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toHex, zeroAddress } from 'viem';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.create();

describe('AgentRegistry', function () {
  async function deployFixture() {
    const [alice, bob] = await viem.getWalletClients();
    const registry = await viem.deployContract('AgentRegistry', [
      'AgentRegistry',
      'AGENT',
      alice.account.address,
      zeroAddress,
    ]);
    const publicClient = await viem.getPublicClient();
    return { registry, alice, bob, publicClient };
  }

  it('mint: mints token with correct owner and URI', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMetadata1', []], { account: alice.account });
    const id = 0n;
    assert.equal((await registry.read.ownerOf([id])).toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(await registry.read.tokenURI([id]), 'zerog://0xAgent123');
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it('mint: mints token with no URI', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, '', '', []], { account: alice.account });
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it('mint: stores and retrieves metadataUri', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xMetaHash', 'zerog://0xRegistryFile', []], { account: alice.account });
    const id = 0n;
    assert.equal(await registry.read.getMetadataUri([id]), 'zerog://0xRegistryFile');
  });

  it('mint: increments totalSupply', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xA', 'zerog://0xMeta1', []], { account: alice.account });
    await registry.write.mint([alice.account.address, 'zerog://0xB', 'zerog://0xMeta2', []], { account: alice.account });
    assert.equal(await registry.read.totalSupply(), 2n);
  });

  it('mint: agentWallet is initialised to owner', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([0n])).toLowerCase(), alice.account.address.toLowerCase());
  });

  it('setTokenURI: updates URI when called by owner', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xOldHash', 'zerog://0xMeta', []], { account: alice.account });
    await registry.write.setTokenURI([0n, 'zerog://0xNewHash'], { account: alice.account });
    assert.equal(await registry.read.tokenURI([0n]), 'zerog://0xNewHash');
  });

  it('setTokenURI: reverts if caller is not owner', async function () {
    const { registry, alice, bob } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    await assert.rejects(
      registry.write.setTokenURI([0n, 'zerog://0xHacked'], { account: bob.account }),
      /Not owner/,
    );
  });


  it('setAgentWallet: sets wallet with valid EIP-712 signature', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    const id = 0n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'AgentRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: id, newWallet: bob.account.address, deadline },
    });
    await registry.write.setAgentWallet([id, bob.account.address, deadline, signature], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([id])).toLowerCase(), bob.account.address.toLowerCase());
  });

  it('setAgentWallet: reverts with expired deadline', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    const deadline = 1n;
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'AgentRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 0n, newWallet: bob.account.address, deadline },
    });
    await assert.rejects(
      registry.write.setAgentWallet([0n, bob.account.address, deadline, signature], { account: alice.account }),
      /Signature expired/,
    );
  });

  it('setAgentWallet: reverts with wrong signer', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await alice.signTypedData({
      domain: { name: 'AgentRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 0n, newWallet: bob.account.address, deadline },
    });
    await assert.rejects(
      registry.write.setAgentWallet([0n, bob.account.address, deadline, signature], { account: alice.account }),
      /Invalid wallet signature/,
    );
  });

  it('setAgentWallet: reverts if caller is not owner', async function () {
    const { registry, alice, bob, publicClient } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const signature = await bob.signTypedData({
      domain: { name: 'AgentRegistry', version: '1', chainId, verifyingContract: registry.address },
      types: { SetAgentWallet: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'SetAgentWallet',
      message: { agentId: 0n, newWallet: bob.account.address, deadline },
    });
    await assert.rejects(
      registry.write.setAgentWallet([0n, bob.account.address, deadline, signature], { account: bob.account }),
      /Not owner/,
    );
  });

  it('unsetAgentWallet: clears wallet to zero address', async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    assert.notEqual((await registry.read.getAgentWallet([0n])), zeroAddress);
    await registry.write.unsetAgentWallet([0n], { account: alice.account });
    assert.equal(await registry.read.getAgentWallet([0n]), zeroAddress);
  });

  it('transfer: clears agentWallet automatically', async function () {
    const { registry, alice, bob } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, 'zerog://0xAgent123', 'zerog://0xMeta', []], { account: alice.account });
    assert.equal((await registry.read.getAgentWallet([0n])).toLowerCase(), alice.account.address.toLowerCase());
    await registry.write.transferFrom([alice.account.address, bob.account.address, 0n], { account: alice.account });
    assert.equal(await registry.read.getAgentWallet([0n]), zeroAddress);
  });
});
