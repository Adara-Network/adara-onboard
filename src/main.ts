/* 2026-05-05 polish pass: bundle entry point.
 *
 * Migration strategy: minimal-diff bridge. The pre-bundle index.html
 * carries ~1400 lines of inline JS using `ethers` and DOM globals
 * (`provider`, `signer`, `state`, `connectWallet`, `addNetwork`, …).
 * Rewriting that all at once would conflict with the designer's
 * upcoming visual rebuild, so we:
 *
 *   - bundle the CDN deps into a real build (Tailwind locally,
 *     ethers as a module dep) so production reliability stops
 *     depending on cdn.tailwindcss.com / cdnjs being up
 *   - expose `window.ethers` so legacy `new ethers.Contract(...)`
 *     calls in the existing inline scripts keep working
 *   - expose `window.adara.connect / addNetwork / toast*` as the
 *     new connection + UX surface; index.html's onclick attributes
 *     point at these instead of the old `connectWallet()` global
 *   - add WalletConnect support so non-injected wallets work
 *   - drop the 2 raw alert() calls in favour of toast UX
 *
 * Designer note: the remaining typed modules (state.ts, resume.ts)
 * are scaffolding for the rebuild — they're correct, type-checked,
 * and runnable, but the legacy inline JS still owns its own state
 * machine. When you replace the view layer, you can either keep the
 * legacy state machine (it works) or swap to the typed modules.
 */

import "./styles.css";
import { ethers } from "ethers";
import { getConfig } from "./config.js";
import {
  connectAuto,
  ensureChain,
  getActiveWallet,
  hasInjectedWallet,
  hasWalletConnect,
} from "./wallet.js";
import {
  toast,
  toastChainError,
  toastError,
  toastInfo,
  toastSuccess,
  toastWarn,
} from "./toast.js";
import { resumeFromChain } from "./resume.js";
import { loadState, rebindAddress, saveState, completeStep } from "./state.js";

const cfg = getConfig();

// ──────────────────── window.ethers shim ────────────────────
// The legacy inline JS in index.html uses `ethers.Contract`, etc. as a
// global (loaded via cdnjs in pre-bundle). Bundle moves ethers into a
// module; expose it on window so the legacy code keeps working until
// the designer rewrites the view layer.
declare global {
  interface Window {
    ethers: typeof ethers;
    adara: {
      connect: () => Promise<void>;
      addNetwork: () => Promise<void>;
      toast: typeof toast;
      toastSuccess: typeof toastSuccess;
      toastError: typeof toastError;
      toastWarn: typeof toastWarn;
      toastInfo: typeof toastInfo;
      toastChainError: typeof toastChainError;
      hasInjectedWallet: () => boolean;
      hasWalletConnect: () => boolean;
      /** Get the connected wallet's signer (or null). */
      getSigner: () => ethers.Signer | null;
      /** Get the connected wallet's BrowserProvider (or null). */
      getProvider: () => ethers.BrowserProvider | null;
      /** Get the connected address (or null). */
      getAddress: () => string | null;
    };
  }
}
window.ethers = ethers;

// ──────────────────── Connect ────────────────────
async function connect(): Promise<void> {
  try {
    const w = await connectAuto();
    await ensureChain();

    // Mirror the connection into the legacy inline-script globals so
    // the rest of the dApp (registerAgent / createVenture / openTask /
    // …) sees the connection without code changes. This is a temporary
    // bridge; designer can drop it when rewriting the view layer.
    (window as any).provider = w.provider;
    (window as any).signer = w.signer;
    (window as any).userAddress = w.address;

    const btn = document.getElementById("connect-btn");
    if (btn) {
      btn.textContent = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
      (btn as HTMLButtonElement).onclick = null;
    }

    // Resume from on-chain state. The legacy `checkRegistration` only
    // checked AgentRegistry; our version also picks up venture history
    // so a returning user lands on step 2+ instead of step 1.
    let state = loadState();
    state = rebindAddress(state, w.address);
    try {
      const r = await resumeFromChain(state, w.provider, w.address);
      if (r.resumedSteps.size > 0) {
        const human = [...r.resumedSteps].join(", ");
        toastInfo(`Welcome back. Resumed: ${human}.`);
      }
    } catch (e) {
      // Resume failure is non-fatal; legacy checkRegistration will
      // still run and pick up basic state.
      console.warn("[adara] resume failed", e);
    }

    // Hand off to the legacy script's UI updaters. They were attached
    // as globals by the inline blocks at index.html:600+. Each is
    // optional — the bridge degrades gracefully if any is missing.
    type Fn = (...a: unknown[]) => unknown;
    const legacy = window as unknown as Record<string, Fn | undefined>;
    if (typeof legacy.checkNetwork === "function") await legacy.checkNetwork();
    if (typeof legacy.updateBalances === "function") await legacy.updateBalances();
    if (typeof legacy.checkRegistration === "function") await legacy.checkRegistration();
    if (typeof legacy.updateUI === "function") legacy.updateUI();

    // Persist the address now that the resume + legacy hand-off
    // succeeded. Subsequent step-completes from the legacy script
    // continue to write to localStorage via its own saveState().
    saveState(state);
  } catch (e) {
    toastChainError(e, "Connection failed");
  }
}

// ──────────────────── Add network ────────────────────
async function addNetwork(): Promise<void> {
  try {
    await ensureChain();
    toastSuccess(`${cfg.chainName} added.`);
  } catch (e) {
    toastChainError(e, "Could not add network");
  }
}

// ──────────────────── Boot ────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Surface the active chain name in the pre-connect hero copy. The
  // static HTML ships neutral copy; this fills the chain name in once
  // config resolves.
  const chainEl = document.getElementById("hero-chain-name");
  if (chainEl) chainEl.textContent = cfg.chainName;

  // Friendly nudge if no wallet path is available.
  if (!hasInjectedWallet() && !hasWalletConnect()) {
    toastWarn("No wallet detected. Install MetaMask / Rabby, or configure WalletConnect.");
  }
});

// ──────────────────── Bridge ────────────────────
window.adara = {
  connect,
  addNetwork,
  toast,
  toastSuccess,
  toastError,
  toastWarn,
  toastInfo,
  toastChainError,
  hasInjectedWallet,
  hasWalletConnect,
  getSigner: () => getActiveWallet()?.signer ?? null,
  getProvider: () => getActiveWallet()?.provider ?? null,
  getAddress: () => getActiveWallet()?.address ?? null,
};

// Helpful: an explicit reference to silence the "step is unused" hint
// for the imports that exist for future use by the designer.
void completeStep;
