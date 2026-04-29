import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zeroHash } from 'viem';
import { network } from 'hardhat';

const { viem, networkHelpers } = await network.create();

describe('ReputationRegistry', function () {
  async function deployFixture() {
    const identity = await viem.deployContract('AgentRegistry');
    const rep = await viem.deployContract('ReputationRegistry');
    await rep.write.initialize([identity.address]);
    const [alice, bob, charlie] = await viem.getWalletClients();

    // Register alice as agent #1
    await identity.write.register(['zerog://0xAgent1Meta'], { account: alice.account });
    const agentId = 1n;

    return { identity, rep, alice, bob, charlie, agentId };
  }

  it('initialize: sets identity registry', async function () {
    const { identity, rep } = await networkHelpers.loadFixture(deployFixture);
    assert.equal((await rep.read.getAgentRegistry()).toLowerCase(), identity.address.toLowerCase());
  });

  it('initialize: reverts on second call', async function () {
    const { identity, rep } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      rep.write.initialize([identity.address]),
      rep, 'AlreadyInitialized',
    );
  });

  it('giveFeedback: stores record and increments feedbackIndex', async function () {
    const { rep, bob, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 87n, 0, 'starred', '', '', '', zeroHash], { account: bob.account });
    assert.equal(await rep.read.getLastIndex([agentId, bob.account.address]), 1n);
    const [value, dec, tag1, , revoked] = await rep.read.readFeedback([agentId, bob.account.address, 1n]);
    assert.equal(value, 87n);
    assert.equal(dec, 0);
    assert.equal(tag1, 'starred');
    assert.equal(revoked, false);
  });

  it('giveFeedback: allows multiple entries from same client', async function () {
    const { rep, bob, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 50n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.giveFeedback([agentId, 75n, 0, '', '', '', '', zeroHash], { account: bob.account });
    assert.equal(await rep.read.getLastIndex([agentId, bob.account.address]), 2n);
  });

  it('giveFeedback: reverts with valueDecimals > 18', async function () {
    const { rep, bob, agentId } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      rep.write.giveFeedback([agentId, 1n, 19, '', '', '', '', zeroHash], { account: bob.account }),
      rep, 'InvalidValueDecimals',
    );
  });

  it('giveFeedback: reverts when agent owner gives feedback', async function () {
    const { rep, alice, agentId } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      rep.write.giveFeedback([agentId, 90n, 0, '', '', '', '', zeroHash], { account: alice.account }),
      rep, 'AgentOwnerCannotRate',
    );
  });

  it('revokeFeedback: marks entry as revoked', async function () {
    const { rep, bob, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 60n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.revokeFeedback([agentId, 1n], { account: bob.account });
    const [, , , , revoked] = await rep.read.readFeedback([agentId, bob.account.address, 1n]);
    assert.equal(revoked, true);
  });

  it('revokeFeedback: reverts on invalid feedbackIndex', async function () {
    const { rep, bob, agentId } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      rep.write.revokeFeedback([agentId, 99n], { account: bob.account }),
      rep, 'FeedbackNotFound',
    );
  });

  it('appendResponse: counts unique responders', async function () {
    const { rep, bob, charlie, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 80n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.appendResponse([agentId, bob.account.address, 1n, 'zerog://0xResp1', zeroHash], { account: charlie.account });
    assert.equal(await rep.read.getResponseCount([agentId, bob.account.address, 1n, []]), 1n);
    // Second call from same responder should not increase count.
    await rep.write.appendResponse([agentId, bob.account.address, 1n, 'zerog://0xResp2', zeroHash], { account: charlie.account });
    assert.equal(await rep.read.getResponseCount([agentId, bob.account.address, 1n, []]), 1n);
  });

  it('getSummary: aggregates non-revoked entries normalised to 18 decimals', async function () {
    const { rep, bob, charlie, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 100n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.giveFeedback([agentId, 200n, 0, '', '', '', '', zeroHash], { account: charlie.account });
    const [count, summaryValue, decimals] = await rep.read.getSummary([agentId, [bob.account.address, charlie.account.address], '', '']);
    assert.equal(count, 2n);
    // 100 + 200 = 300 normalised to 18 decimals
    assert.equal(summaryValue, 300n * (10n ** 18n));
    assert.equal(decimals, 18);
  });

  it('getSummary: excludes revoked entries', async function () {
    const { rep, bob, charlie, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 100n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.revokeFeedback([agentId, 1n], { account: bob.account });
    await rep.write.giveFeedback([agentId, 50n, 0, '', '', '', '', zeroHash], { account: charlie.account });
    const [count, summaryValue] = await rep.read.getSummary([agentId, [bob.account.address, charlie.account.address], '', '']);
    assert.equal(count, 1n);
    assert.equal(summaryValue, 50n * (10n ** 18n));
  });

  it('getSummary: reverts with empty clientAddresses', async function () {
    const { rep, agentId } = await networkHelpers.loadFixture(deployFixture);
    await viem.assertions.revertWithCustomError(
      rep.read.getSummary([agentId, [], '', '']),
      rep, 'EmptyClientAddresses',
    );
  });

  it('getClients: returns all clients who gave feedback', async function () {
    const { rep, bob, charlie, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 1n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.giveFeedback([agentId, 1n, 0, '', '', '', '', zeroHash], { account: charlie.account });
    const clients = await rep.read.getClients([agentId]);
    assert.equal(clients.length, 2);
  });

  it('readAllFeedback: returns all non-revoked entries by default', async function () {
    const { rep, bob, charlie, agentId } = await networkHelpers.loadFixture(deployFixture);
    await rep.write.giveFeedback([agentId, 10n, 0, '', '', '', '', zeroHash], { account: bob.account });
    await rep.write.giveFeedback([agentId, 20n, 0, '', '', '', '', zeroHash], { account: charlie.account });
    await rep.write.revokeFeedback([agentId, 1n], { account: bob.account });

    const [clients] = await rep.read.readAllFeedback([agentId, [], '', '', false]);
    assert.equal(clients.length, 1); // bob's is revoked, only charlie's shows
  });
});
