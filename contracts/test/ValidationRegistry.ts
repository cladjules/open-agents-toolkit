import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keccak256, toHex, zeroHash } from 'viem';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.create();

describe('ValidationRegistry', function () {
  async function deployFixture() {
    const identity = await viem.deployContract('IdentityRegistry');
    const val = await viem.deployContract('ValidationRegistry');
    await val.write.initialize([identity.address]);
    const [alice, bob, validator] = await viem.getWalletClients();

    // Register alice as agent #1
    await identity.write.register(['zerog://0xAgent1Meta'], { account: alice.account });
    const agentId = 1n;

    return { identity, val, alice, bob, validator, agentId };
  }

  it('initialize: sets identity registry', async function () {
    const { identity, val } = await networkHelpers.loadFixture(deployFixture);
    assert.equal((await val.read.getIdentityRegistry()).toLowerCase(), identity.address.toLowerCase());
  });

  it('initialize: reverts on second call', async function () {
    const { identity, val } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      val.write.initialize([identity.address]),
      val, 'AlreadyInitialized',
    );
  });

  it('validationRequest: emits event and stores request', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload1'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq1', requestHash], { account: alice.account });
    const hashes = await val.read.getAgentValidations([agentId]);
    assert.equal(hashes.length, 1);
    assert.equal(hashes[0], requestHash);
  });

  it('validationRequest: reverts if caller is not owner or operator', async function () {
    const { val, bob, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload2'));
    await viem.assertions.revertWithCustomError(
      val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq2', requestHash], { account: bob.account }),
      val, 'NotOwnerOrOperator',
    );
  });

  it('validationResponse: stores response and can be called multiple times', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload3'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq3', requestHash], { account: alice.account });

    await val.write.validationResponse([requestHash, 100, '', zeroHash, 'final'], { account: validator.account });
    const [, , response, , tag] = await val.read.getValidationStatus([requestHash]);
    assert.equal(response, 100);
    assert.equal(tag, 'final');

    // Second call (progressive finality)
    await val.write.validationResponse([requestHash, 80, '', zeroHash, 'updated'], { account: validator.account });
    const [, , r2, , t2] = await val.read.getValidationStatus([requestHash]);
    assert.equal(r2, 80);
    assert.equal(t2, 'updated');
  });

  it('validationResponse: reverts with response > 100', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload4'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq4', requestHash], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      val.write.validationResponse([requestHash, 101, '', zeroHash, ''], { account: validator.account }),
      val, 'InvalidResponse',
    );
  });

  it('validationResponse: reverts if caller is not the designated validator', async function () {
    const { val, alice, bob, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload5'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq5', requestHash], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      val.write.validationResponse([requestHash, 100, '', zeroHash, ''], { account: bob.account }),
      val, 'NotRequestedValidator',
    );
  });

  it('getValidationStatus: reverts for unknown requestHash', async function () {
    const { val } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      val.read.getValidationStatus([keccak256(toHex('unknown'))]),
      val, 'RequestNotFound',
    );
  });

  it('getSummary: counts responded requests', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const h1 = keccak256(toHex('p1'));
    const h2 = keccak256(toHex('p2'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xR', h1], { account: alice.account });
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xR', h2], { account: alice.account });
    await val.write.validationResponse([h1, 100, '', zeroHash, ''], { account: validator.account });
    await val.write.validationResponse([h2, 80, '', zeroHash, ''], { account: validator.account });
    const [count, avg] = await val.read.getSummary([agentId, [], '']);
    assert.equal(count, 2n);
    assert.equal(avg, 90); // (100+80)/2
  });

  it('getValidatorRequests: returns requests assigned to validator', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('pv'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xRV', requestHash], { account: alice.account });
    const hashes = await val.read.getValidatorRequests([validator.account.address]);
    assert.equal(hashes.length, 1);
    assert.equal(hashes[0], requestHash);
  });
});
