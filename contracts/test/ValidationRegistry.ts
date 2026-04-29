import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { keccak256, toHex, zeroHash, encodePacked } from 'viem';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.create();

describe('ValidationRegistry', function () {
  async function deployFixture() {
    const identity = await viem.deployContract('AgentRegistry');
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
    assert.equal((await val.read.getAgentRegistry()).toLowerCase(), identity.address.toLowerCase());
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

    await val.write.validationResponse([requestHash, 100, '', zeroHash, 'final', '0x'], { account: validator.account });
    const [, , response, , tag] = await val.read.getValidationStatus([requestHash]);
    assert.equal(response, 100);
    assert.equal(tag, 'final');

    // Second call (progressive finality)
    await val.write.validationResponse([requestHash, 80, '', zeroHash, 'updated', '0x'], { account: validator.account });
    const [, , r2, , t2] = await val.read.getValidationStatus([requestHash]);
    assert.equal(r2, 80);
    assert.equal(t2, 'updated');
  });

  it('validationResponse: reverts with response > 100', async function () {
    const { val, alice, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload4'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq4', requestHash], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      val.write.validationResponse([requestHash, 101, '', zeroHash, '', '0x'], { account: validator.account }),
      val, 'InvalidResponse',
    );
  });

  it('validationResponse: reverts if caller is not the designated validator', async function () {
    const { val, alice, bob, validator, agentId } = await networkHelpers.loadFixture(deployFixture);
    const requestHash = keccak256(toHex('payload5'));
    await val.write.validationRequest([validator.account.address, agentId, 'zerog://0xReq5', requestHash], { account: alice.account });
    await viem.assertions.revertWithCustomError(
      val.write.validationResponse([requestHash, 100, '', zeroHash, '', '0x'], { account: bob.account }),
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
    await val.write.validationResponse([h1, 100, '', zeroHash, '', '0x'], { account: validator.account });
    await val.write.validationResponse([h2, 80, '', zeroHash, '', '0x'], { account: validator.account });
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

  it('validationResponse (TEE): accepts valid oracle proof via TEEVerifier', async function () {
    const [alice, , , oracle] = await viem.getWalletClients();
    const identity = await viem.deployContract('AgentRegistry');
    const val = await viem.deployContract('ValidationRegistry');
    await val.write.initialize([identity.address]);
    const tee = await viem.deployContract('TEEVerifier');
    const [owner] = await viem.getWalletClients();
    await tee.write.addOracle([oracle.account.address], { account: owner.account });

    await identity.write.register(['zerog://0xTEEAgent'], { account: alice.account });
    const agentId = 1n;
    const requestHash = keccak256(toHex('tee-payload'));
    const response = 95;

    // Request validation against the TEEVerifier contract.
    await val.write.validationRequest([tee.address, agentId, 'zerog://0xTEEReq', requestHash], { account: alice.account });

    // Oracle signs keccak256(agentId, requestHash, response).
    const publicClient = await viem.getPublicClient();
    const innerHash = keccak256(encodePacked(['uint256', 'bytes32', 'uint8'], [agentId, requestHash, response]));
    const proof = await oracle.signMessage({ message: { raw: innerHash } });

    await val.write.validationResponse([requestHash, response, '', zeroHash, 'tee-pass', proof]);
    const [, , storedResponse, , tag] = await val.read.getValidationStatus([requestHash]);
    assert.equal(storedResponse, response);
    assert.equal(tag, 'tee-pass');
  });

  it('validationResponse (TEE): rejects invalid oracle proof', async function () {
    const [alice, bob] = await viem.getWalletClients();
    const identity = await viem.deployContract('AgentRegistry');
    const val = await viem.deployContract('ValidationRegistry');
    await val.write.initialize([identity.address]);
    const tee = await viem.deployContract('TEEVerifier');
    // No oracle registered.

    await identity.write.register(['zerog://0xTEEAgent2'], { account: alice.account });
    const agentId = 1n;
    const requestHash = keccak256(toHex('tee-bad'));
    const response = 50;

    await val.write.validationRequest([tee.address, agentId, 'zerog://0xTEEReq2', requestHash], { account: alice.account });

    const innerHash = keccak256(encodePacked(['uint256', 'bytes32', 'uint8'], [agentId, requestHash, response]));
    const badProof = await bob.signMessage({ message: { raw: innerHash } });

    await viem.assertions.revertWithCustomError(
      val.write.validationResponse([requestHash, response, '', zeroHash, '', badProof]),
      val, 'OracleVerificationFailed',
    );
  });
});
