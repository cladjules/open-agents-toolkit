import type { Chain } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { APP_CHAIN, ENS_CHAIN, zeroGMainnet, zeroGTestnet } from "../config";
/**
 * Switch to either ENS chain (Sepolia/Mainnet) or 0G chain
 * @param getEip1193Provider - Function to get the EIP-1193 provider from wallet
 * @param isENSChain - If true, switch to ENS_CHAIN (Sepolia/Mainnet). If false, switch to 0G.
 */
export async function switchChainIfNeeded(
  getEip1193Provider: () => Promise<any>,
  isENSChain: boolean,
) {
  const targetChain = isENSChain ? ENS_CHAIN : APP_CHAIN;

  const provider = await getEip1193Provider();
  const targetChainIdHex = `0x${targetChain.id.toString(16)}`;
  const targetRpc = targetChain.rpcUrls.default.http[0] ?? "";

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainIdHex }],
    });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: targetChainIdHex,
            chainName: targetChain.name,
            rpcUrls: targetRpc ? [targetRpc] : [],
            nativeCurrency: targetChain.nativeCurrency,
          },
        ],
      });
    } else throw e;
  }
}
