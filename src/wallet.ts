/* 2026-05-05 polish pass: wallet connection + chain switching.
 *
 * Two connection paths:
 *   - Injected (window.ethereum) — MetaMask, Rabby, Brave, Coinbase Wallet
 *     desktop extension. Pre-existing path, preserved.
 *   - WalletConnect v2 — mobile wallets (Coinbase Wallet mobile, Trust,
 *     Rainbow, etc.) and any wallet that hasn't shipped a browser
 *     extension. NEW. Optional — requires WALLETCONNECT_PROJECT_ID.
 *
 * Designer note: the connect button stays a single CTA. The backend
 * picks injected vs WalletConnect based on what's available. If the
 * designer wants a "choose your wallet" modal, swap the branching
 * here for a chooser-modal UI hook — the rest of the dApp doesn't care.
 */

import { ethers } from "ethers";
import { getConfig } from "./config.js";
import { toastChainError, toastWarn } from "./toast.js";

// 2026-05-05 polish pass: WalletConnect is ~250kB gzip — load it lazily
// so injected-wallet users (the common case) don't pay for it. The
// import only happens when the user explicitly picks the WalletConnect
// path (or auto-pick falls through to it).
async function loadWalletConnect() {
  const mod = await import("@walletconnect/ethereum-provider");
  return mod.EthereumProvider;
}

export type ConnectedProvider = ethers.BrowserProvider;
export interface ConnectedWallet {
  provider: ConnectedProvider;
  signer: ethers.Signer;
  address: string;
  /** Underlying EIP-1193 provider used for chain ops + listener cleanup. */
  eip1193: { request: (a: unknown) => Promise<unknown>; on?: (e: string, h: (...a: unknown[]) => void) => void };
}

let active: ConnectedWallet | null = null;

export function getActiveWallet(): ConnectedWallet | null {
  return active;
}

/** True if any browser-injected wallet is present. */
export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && !!(window as any).ethereum;
}

/** True if WalletConnect can be used (project id configured). */
export function hasWalletConnect(): boolean {
  return !!getConfig().walletConnectProjectId;
}

export async function connectInjected(): Promise<ConnectedWallet> {
  const eth = (window as any).ethereum;
  if (!eth) {
    toastWarn("No injected wallet found. Install MetaMask, Rabby, or use WalletConnect.");
    throw new Error("no injected wallet");
  }
  await eth.request({ method: "eth_requestAccounts" });
  return finalise(eth);
}

export async function connectWalletConnect(): Promise<ConnectedWallet> {
  const cfg = getConfig();
  if (!cfg.walletConnectProjectId) {
    toastWarn("WalletConnect not configured for this deployment.");
    throw new Error("walletconnect project id missing");
  }
  const EthereumProvider = await loadWalletConnect();
  const wc = await EthereumProvider.init({
    projectId: cfg.walletConnectProjectId,
    chains: [cfg.chainId],
    showQrModal: true,
    metadata: {
      name: "Adara Protocol — Onboard",
      description: "Tester onboarding for the Adara Protocol",
      url: location.origin,
      icons: [`${location.origin}/icon-512.png`],
    },
  });
  await wc.connect();
  return finalise(wc as unknown as ConnectedWallet["eip1193"]);
}

/**
 * Auto-pick a connection method:
 *   - prefer injected when present (faster + no QR scan)
 *   - fall back to WalletConnect when available
 */
export async function connectAuto(): Promise<ConnectedWallet> {
  if (hasInjectedWallet()) return connectInjected();
  if (hasWalletConnect()) return connectWalletConnect();
  toastWarn("No wallet available. Install a browser extension wallet, or open this on a device with a wallet app.");
  throw new Error("no wallet path available");
}

async function finalise(eip1193: ConnectedWallet["eip1193"]): Promise<ConnectedWallet> {
  const provider = new ethers.BrowserProvider(eip1193 as any);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  active = { provider, signer, address, eip1193 };
  // Bridge for the legacy inline scripts in index.html that read
  // `window.ethereum.request(...)` directly (e.g. switchNetwork). When
  // a user connects via WalletConnect on a wallet-app-only device,
  // there is no injected window.ethereum — exposing the WC provider
  // here keeps the legacy code paths working until the designer
  // rewrites them to use window.adara.* explicitly.
  if (!(window as any).ethereum) {
    (window as any).ethereum = eip1193;
  }
  // Re-emit the standard reload-on-chain/account-change behaviour the
  // pre-bundle code had. Designer can replace with a softer in-app
  // refresh once the resume flow is fully fleshed out, but reload is
  // safe and simple.
  if (eip1193.on) {
    eip1193.on("chainChanged", () => location.reload());
    eip1193.on("accountsChanged", () => location.reload());
  }
  return active;
}

export async function ensureChain(): Promise<void> {
  const cfg = getConfig();
  const w = active;
  if (!w) throw new Error("not connected");
  const net = await w.provider.getNetwork();
  if (Number(net.chainId) === cfg.chainId) return;
  try {
    await w.eip1193.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: cfg.chainIdHex }],
    });
  } catch (e: any) {
    if (e?.code === 4902) {
      try {
        await w.eip1193.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: cfg.chainIdHex,
            chainName: cfg.chainName,
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [cfg.rpcUrl],
          }],
        });
      } catch (addErr) {
        toastChainError(addErr, "Could not add network");
        throw addErr;
      }
    } else {
      toastChainError(e, "Could not switch network");
      throw e;
    }
  }
}

export function disconnect(): void {
  active = null;
}
