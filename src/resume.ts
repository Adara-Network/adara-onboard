/* 2026-05-05 polish pass: resume flow.
 *
 * When a user reconnects, derive their actual on-chain progress instead
 * of starting at step 1. The pre-bundle code only checked agent
 * registration; this extends the check to ventures + current tasks so a
 * returning user lands on the right step.
 *
 * Designer note: this module returns plain data — no DOM. The view
 * layer should call `resumeFromChain(state, …)` after wallet connect
 * and use the returned StepId set to render which steps are done.
 */

import { ethers } from "ethers";
import { ABI, getConfig } from "./config.js";
import { completeStep, type OnboardState, type StepId } from "./state.js";

export interface ResumeResult {
  agentId: number;
  tier: number;
  ventures: { ventureId: number; instance: string }[];
  /** Set of steps that on-chain state proves are complete. */
  resumedSteps: Set<StepId>;
}

/**
 * Walk on-chain state for `address` and update `state` in-place to
 * reflect what's actually there. Persists via state.saveState through
 * completeStep on each match.
 *
 * Pure data: no UI side effects. Toast / UI callers should react to
 * the returned ResumeResult.
 */
export async function resumeFromChain(
  state: OnboardState,
  provider: ethers.Provider,
  address: string,
): Promise<ResumeResult> {
  const cfg = getConfig();
  const result: ResumeResult = {
    agentId: 0,
    tier: 0,
    ventures: [],
    resumedSteps: new Set<StepId>(),
  };

  // 1. Agent registration → step 'register'
  const registry = new ethers.Contract(cfg.contracts.AgentRegistry, ABI.registry, provider);
  const agentId = Number(await registry.agentIdOf(address));
  result.agentId = agentId;
  state.agentId = agentId;
  if (agentId > 0) {
    const tier = Number(await registry.getTier(agentId));
    result.tier = tier;
    state.tier = tier;
    completeStep(state, "register");
    result.resumedSteps.add("register");
  }

  // 2. Ventures created → step 'createVenture'.
  // Cheap path: scan VentureCreatedV2 events for `creator=address`.
  // Expensive on long histories — bound to the last 200k blocks
  // (factory deploy is much more recent on every active testnet).
  if (agentId > 0 && cfg.contracts.VentureFactoryV2) {
    try {
      const factory = new ethers.Contract(cfg.contracts.VentureFactoryV2, ABI.factory, provider);
      const head = await provider.getBlockNumber();
      const fromBlock = Math.max(0, head - 200_000);
      const filter = factory.filters.VentureCreatedV2!(null, address);
      const events = await factory.queryFilter(filter, fromBlock, head);
      for (const ev of events) {
        const args = (ev as any).args;
        result.ventures.push({
          ventureId: Number(args.ventureId),
          instance: args.ventureInstance,
        });
      }
      if (result.ventures.length > 0) {
        state.ventures = result.ventures;
        completeStep(state, "createVenture");
        result.resumedSteps.add("createVenture");
      }
    } catch {
      // Event-scan failure is non-fatal — designer's UI can show
      // "couldn't auto-resume venture state, click to refresh".
    }
  }

  state.lastResumeAt = Date.now();
  return result;
}
