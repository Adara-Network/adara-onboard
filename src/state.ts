/* 2026-05-05 polish pass: state machine + persistence.
 *
 * The 7 onboarding steps are linear with one branch (step 2 requires
 * tier ≥ 2). State is persisted to localStorage so a refresh doesn't
 * restart the flow; the resume helpers (see resume.ts) re-derive
 * progress from on-chain state when the wallet connects.
 *
 * Designer note: the step IDs here are stable contract — the visual
 * layer can rename labels but should keep the IDs (`register`,
 * `createVenture`, …) so chain-side resume + persistence keep working.
 */

export type StepId =
  | "register"
  | "createVenture"
  | "fundBudget"
  | "openTask"
  | "claimTask"
  | "verify"
  | "claimCash";

export const STEP_IDS: readonly StepId[] = [
  "register", "createVenture", "fundBudget", "openTask",
  "claimTask", "verify", "claimCash",
] as const;

export interface OnboardState {
  address: string | null;
  agentId: number;
  tier: number;
  stepsCompleted: StepId[];
  ventures: { ventureId: number; instance: string }[];
  currentTaskId: number | null;
  /** Last-seen on-chain venture refresh timestamp (ms) — for cache freshness. */
  lastResumeAt: number;
}

const STORAGE_KEY = "adara-tester";

const EMPTY: OnboardState = {
  address: null,
  agentId: 0,
  tier: 0,
  stepsCompleted: [],
  ventures: [],
  currentTaskId: null,
  lastResumeAt: 0,
};

export function loadState(): OnboardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<OnboardState>;
    return { ...EMPTY, ...parsed, stepsCompleted: parsed.stepsCompleted ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

export function saveState(state: OnboardState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function completeStep(state: OnboardState, step: StepId): void {
  if (!state.stepsCompleted.includes(step)) {
    state.stepsCompleted.push(step);
    saveState(state);
  }
}

/** Replace the persisted state with one keyed on a different address. */
export function rebindAddress(state: OnboardState, address: string): OnboardState {
  if (state.address && state.address.toLowerCase() !== address.toLowerCase()) {
    // Different wallet connected — start fresh. The resume helper will
    // re-populate progress from on-chain state for the new address.
    const fresh: OnboardState = { ...EMPTY, address };
    saveState(fresh);
    return fresh;
  }
  state.address = address;
  saveState(state);
  return state;
}
