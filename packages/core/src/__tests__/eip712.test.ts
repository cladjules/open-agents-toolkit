import { describe, it, expect } from "vitest";
import { hashPayload, generateNonce, buildDomain, buildSignedRequestMessage } from "../eip712.js";

describe("EIP-712 utilities", () => {
  it("hashPayload produces a 32-byte hex", () => {
    const hash = hashPayload({ action: "transfer", amount: 100 });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("hashPayload is deterministic and key-order-independent", () => {
    const a = hashPayload({ a: 1, b: 2 });
    const b = hashPayload({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("generateNonce produces a 32-byte hex", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it("two nonces are different", () => {
    expect(generateNonce()).not.toBe(generateNonce());
  });

  it("buildDomain sets chainId", () => {
    const domain = buildDomain(1);
    expect(domain.chainId).toBe(1);
    expect(domain.name).toBe("OpenAgentsToolkit");
  });

  it("buildSignedRequestMessage encodes bigints", () => {
    const msg = buildSignedRequestMessage({
      payload: { foo: "bar" },
      chainId: 1,
      agentAddress: "0x0000000000000000000000000000000000000001",
      timestamp: 1700000000,
      nonce: generateNonce(),
    });
    expect(typeof msg.chainId).toBe("bigint");
    expect(typeof msg.timestamp).toBe("bigint");
  });
});
