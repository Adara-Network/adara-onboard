/* 2026-05-05 polish pass: toast notifications.
 *
 * Replaces 2 raw alert() calls + standardises error/success surfaces
 * across the dApp. Auto-dismisses, manually dismissable, accessible
 * via aria-live so screen readers announce them.
 *
 * Designer note: visual styling is in src/styles.css under .toast.*.
 * The DOM contract is { container with .toast-container } > many
 * { .toast.toast-{success,error,warn,info} }.
 */

export type ToastKind = "success" | "error" | "warn" | "info";

interface ToastOptions {
  kind?: ToastKind;
  /** Auto-dismiss after N ms. 0 = sticky. Default: 4500 for non-error, 7000 for error. */
  durationMs?: number;
  /** Optional action button (e.g. "Retry"). */
  action?: { label: string; onClick: () => void };
}

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "true");
  document.body.appendChild(container);
  return container;
}

export function toast(message: string, opts: ToastOptions = {}): void {
  const kind = opts.kind ?? "info";
  const duration = opts.durationMs ?? (kind === "error" ? 7000 : 4500);

  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.setAttribute("role", kind === "error" ? "alert" : "status");

  const text = document.createElement("div");
  text.textContent = message;
  node.appendChild(text);

  if (opts.action) {
    const btn = document.createElement("button");
    btn.textContent = opts.action.label;
    btn.className = "mt-2 text-cyan text-xs font-semibold underline";
    btn.onclick = () => { opts.action!.onClick(); dismiss(node); };
    node.appendChild(btn);
  }

  const dismissBtn = document.createElement("button");
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.className = "absolute top-1 right-2 text-muted-dim hover:text-pearl text-lg leading-none";
  dismissBtn.style.cssText = "position:absolute;top:.25rem;right:.5rem;color:#6b7280;font-size:1rem;line-height:1;background:none;border:none;cursor:pointer;";
  dismissBtn.textContent = "×";
  dismissBtn.onclick = () => dismiss(node);
  node.style.position = "relative";
  node.appendChild(dismissBtn);

  ensureContainer().appendChild(node);

  if (duration > 0) {
    setTimeout(() => dismiss(node), duration);
  }
}

function dismiss(node: HTMLElement): void {
  if (!node.isConnected) return;
  node.classList.add("toast-leaving");
  node.addEventListener("animationend", () => node.remove(), { once: true });
}

export function toastSuccess(message: string): void { toast(message, { kind: "success" }); }
export function toastError(message: string, action?: ToastOptions["action"]): void {
  toast(message, { kind: "error", action });
}
export function toastWarn(message: string): void { toast(message, { kind: "warn" }); }
export function toastInfo(message: string): void { toast(message, { kind: "info" }); }

/**
 * Map a thrown error to a user-friendly toast message. Centralises the
 * common chain / wallet failure modes that the pre-bundle code only
 * surfaced via console.error.
 */
export function toastChainError(err: unknown, hint?: string): void {
  const e = err as { code?: number | string; message?: string; reason?: string };
  const msg = e?.message ?? String(err);

  if (e?.code === 4001 || /user rejected/i.test(msg)) {
    return toastWarn("Transaction rejected in your wallet.");
  }
  if (e?.code === 4902) {
    return toastWarn("Network not added to your wallet — switching now.");
  }
  if (/insufficient funds/i.test(msg)) {
    return toastError("Not enough ETH for gas. Top up and try again.");
  }
  if (/network|fetch|timeout|econn/i.test(msg)) {
    return toastError("Network problem talking to the chain. Try again in a moment.");
  }
  if (/invalid signer|provider/i.test(msg)) {
    return toastError("Wallet not connected. Reconnect and retry.");
  }
  // Fallback: short, sanitised message.
  const short = (e?.reason ?? msg).slice(0, 200);
  toastError(hint ? `${hint}: ${short}` : short);
}
