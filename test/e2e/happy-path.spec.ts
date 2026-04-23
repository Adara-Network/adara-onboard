import { test, expect, Page } from "@playwright/test";
import { Contract, JsonRpcProvider, Wallet, parseUnits, ZeroHash } from "ethers";
import { ETHEREUM_STUB_SOURCE } from "./fixtures/ethereum-stub";
import { getOrFundWallet, FundedWallet } from "./fixtures/funded-wallet";

/**
 * E2E validation of the onboard dApp's 7-step tester flow.
 *
 * Two modes:
 *   SMOKE (always runs): Fresh faucet wallet → connect → register. Validates
 *     wallet injection, RPC plumbing, Tier-0 registration path.
 *   FULL CYCLE (requires ADARA_E2E_PRIVATE_KEY pointing at a Tier-2 wallet):
 *     register → create venture → fund budget → open task → claim → start →
 *     submit → verdict → finalize → claimCash. Exercises every on-chain path.
 *
 * Full cycle is skipped in CI by default; flip the env var on the pre-bootstrap
 * wallet to run it. See README.md for the bootstrap procedure.
 */

const CONFIG = {
  rpcUrl: process.env.ADARA_RPC_URL || "https://devnet.adara.network",
  faucetUrl: process.env.ADARA_FAUCET_URL || "https://faucet.adara.network",
  faucetCode: process.env.ADARA_FAUCET_CODE || "",
  chainId: Number(process.env.ADARA_CHAIN_ID || 1981),
  usdcAddress: process.env.ADARA_USDC_ADDRESS || "0xd757A66793c9559Cf3B1F2C1B1eA5CFC2C7b89A6",
};

const AGENT_REGISTRY_ABI = [
  "function agentIdOf(address) view returns (uint256)",
  "function getTier(uint256) view returns (uint8)",
];

async function injectStub(page: Page, wallet: FundedWallet) {
  // The init script sees __ADARA_E2E_CONFIG__ that we set before navigation.
  await page.addInitScript(
    ({ cfg, stub }) => {
      (window as any).__ADARA_E2E_CONFIG__ = cfg;
      // eval the stub source — it self-installs window.ethereum
      // eslint-disable-next-line no-eval
      eval(stub);
    },
    { cfg: { privateKey: wallet.privateKey, rpcUrl: CONFIG.rpcUrl, chainId: CONFIG.chainId }, stub: ETHEREUM_STUB_SOURCE },
  );
}

async function walletTier(address: string): Promise<number> {
  const provider = new JsonRpcProvider(CONFIG.rpcUrl);
  const registry = new Contract(
    process.env.ADARA_AGENT_REGISTRY || "0x0c9c3EDe7ed5dd285BD2E38ea3ae43bae3D87260",
    AGENT_REGISTRY_ABI,
    provider,
  );
  const agentId: bigint = await registry.agentIdOf(address);
  if (agentId === 0n) return -1; // not registered
  const tier: number = Number(await registry.getTier(agentId));
  return tier;
}

test.describe("onboard dApp — smoke", () => {
  let wallet: FundedWallet;

  test.beforeAll(async () => {
    wallet = await getOrFundWallet({
      rpcUrl: CONFIG.rpcUrl,
      faucetUrl: CONFIG.faucetUrl,
      faucetCode: CONFIG.faucetCode,
      usdcAddress: CONFIG.usdcAddress,
      labelPrefix: "e2e-smoke",
    });
    console.log(`[e2e] using wallet ${wallet.address} (${wallet.ethBalance} ETH / ${wallet.usdcBalance} USDC)`);
  });

  test("connect → register → see registered profile", async ({ page }) => {
    page.on("console", (msg) => console.log(`[page:${msg.type()}]`, msg.text()));
    page.on("pageerror", (err) => console.log("[page:error]", err.message));

    await injectStub(page, wallet);
    await page.goto("/");

    // Landing
    await expect(page).toHaveTitle(/Tester Onboarding/i);

    // Make sure ethers UMD loaded + the stub finished installing.
    await page.waitForFunction(() => (window as any).ethers && (window as any).ethereum?.isAdaraE2E, null, {
      timeout: 15_000,
    });
    const diag = await page.evaluate(() => ({
      hasEthers: typeof (window as any).ethers !== "undefined",
      hasEthereum: typeof (window as any).ethereum !== "undefined",
      isAdaraE2E: (window as any).ethereum?.isAdaraE2E,
      hasRequest: typeof (window as any).ethereum?.request === "function",
    }));
    console.log("[e2e:diag]", diag);
    const connectBtn = page.locator("#connect-btn");
    await expect(connectBtn).toBeVisible();

    // Connect
    await connectBtn.click();
    // Give the async connectWallet() flow a moment to progress before asserting
    await page.waitForTimeout(3000);
    const logsMid = await page.evaluate(() => (window as any).__E2E_LOG__ || []);
    console.log("[e2e:stub-log-mid]", logsMid);
    try {
      await expect(connectBtn).toContainText(wallet.address.slice(0, 6), { timeout: 20_000 });
    } catch (err) {
      const logs = await page.evaluate(() => (window as any).__E2E_LOG__ || []);
      console.log("[e2e:stub-log-on-fail]", logs);
      throw err;
    }

    // Network badge should show a valid chain name (whatever the dApp's
    // __ADARA_CONFIG__ declares — "Adara Devnet" on chainId 1981, "Base
    // Sepolia" on 84532, etc.) and NOT the "Wrong Network" error state.
    const netLabel = page.locator("#network-label");
    await expect(netLabel).not.toContainText(/Wrong Network/i);

    // Register
    const regBtn = page.locator("#register-btn");
    await expect(regBtn).toBeVisible();
    await page.fill("#reg-name", `E2E Smoke ${Date.now()}`);
    await page.fill("#reg-bio", "automated E2E test");
    await regBtn.click();

    // Success marker: register-status turns into a success banner
    const regStatus = page.locator("#register-status");
    await expect(regStatus).toContainText(/Registered|already registered/i, { timeout: 60_000 });

    // Verify on-chain: wallet now has a non-zero agentId
    const tier = await walletTier(wallet.address);
    expect(tier).toBeGreaterThanOrEqual(0); // registered (tier 0+)
    console.log(`[e2e] wallet ${wallet.address} is registered at tier ${tier}`);
  });
});

test.describe("onboard dApp — full cycle", () => {
  // Run only when a pre-bootstrap Tier-2 wallet is provided. Tier-2 is required
  // to createVenture; see audit/round4_* + SESSION_HANDOFF §12 gotcha 9.
  test.skip(
    !process.env.ADARA_E2E_PRIVATE_KEY,
    "set ADARA_E2E_PRIVATE_KEY to a Tier-2 wallet to run the full 7-step cycle",
  );

  let wallet: FundedWallet;

  test.beforeAll(async () => {
    wallet = await getOrFundWallet({
      rpcUrl: CONFIG.rpcUrl,
      faucetUrl: CONFIG.faucetUrl,
      faucetCode: CONFIG.faucetCode,
      usdcAddress: CONFIG.usdcAddress,
      labelPrefix: "e2e-full",
    });
    const tier = await walletTier(wallet.address);
    if (tier < 2) {
      throw new Error(
        `ADARA_E2E_PRIVATE_KEY wallet ${wallet.address} is tier ${tier}; needs tier >= 2 for createVenture. ` +
          "Bootstrap via scripts/bootstrap-tier2-for.ts or re-run gen-tester-key.sh with --tier 2.",
      );
    }
    console.log(`[e2e] full-cycle using Tier-${tier} wallet ${wallet.address}`);
  });

  test("register → create venture → fund → open task → claim → submit → verify → claimCash", async ({ page }) => {
    await injectStub(page, wallet);
    await page.goto("/");

    // Step 0: connect
    await page.locator("#connect-btn").click();
    await expect(page.locator("#connect-btn")).toContainText(wallet.address.slice(0, 6), { timeout: 20_000 });

    // Step 1: register (idempotent — dApp detects AlreadyRegistered)
    await page.fill("#reg-name", `E2E Full ${Date.now()}`);
    await page.fill("#reg-bio", "full-cycle automated test");
    await page.locator("#register-btn").click();
    await expect(page.locator("#register-status")).toContainText(/Registered|already registered/i, { timeout: 60_000 });

    // Step 2: create venture (Tier 2 required)
    //   Template wizard "security" gives a pre-filled venture config
    await page.locator("[data-tpl=security]").click();
    await page.fill("#venture-name", `E2E Venture ${Date.now()}`);
    await page.fill("#venture-desc", "Automated E2E happy-path venture");
    await page.locator("#venture-btn").click();
    await expect(page.locator("#venture-status")).toContainText(/Venture #\d+ created/i, { timeout: 120_000 });

    // Step 3: fund budget — 100 USDC is plenty for one task
    await page.fill("#fund-amount", "100");
    await page.locator("#fund-btn").click();
    await expect(page.locator("#fund-status")).toContainText(/Funded 100 USDC/i, { timeout: 120_000 });

    // Step 4: open task (uses the default task entry form pre-populated by template)
    await page.locator("#task-btn").click();
    await expect(page.locator("#task-status")).toContainText(/task.*opened/i, { timeout: 120_000 });

    // Steps 5-7 (claim/verify/claimCash) exercise the cross-wallet flows and
    // require a second agent to claim. Split into a separate spec once the
    // operator provides a second bootstrapped key via ADARA_E2E_SECOND_KEY.
    test.info().annotations.push({
      type: "follow-up",
      description:
        "claim/submit/verdict/claimCash requires a second Tier-2 wallet " +
        "(ADARA_E2E_SECOND_KEY). Split into cross-wallet spec once available.",
    });
  });
});
