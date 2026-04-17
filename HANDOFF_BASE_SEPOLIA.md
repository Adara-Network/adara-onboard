# Adara Protocol — Base Sepolia Migration Handoff

**Last updated:** 2026-04-16
**Status:** Engineering work complete. 4 user-gated steps remain.

This document is the handoff between the engineering batch I just shipped (E2E
harness, config-driven onboard, USDC-swap-ready deploy script) and the human
operator steps that only you can do.

---

## What's already landed

### In `adara-onboard` (this repo)

- **`package.json` / `playwright.config.ts` / `tsconfig.json`** — Playwright
  harness, no Synpress/MetaMask, deterministic via `window.ethereum` stub.
- **`test/e2e/fixtures/ethereum-stub.ts`** — injectable stub backed by
  `ethers.Wallet` + `JsonRpcProvider`. Handles `eth_requestAccounts`,
  `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`,
  `wallet_switchEthereumChain`, `wallet_addEthereumChain`.
- **`test/e2e/fixtures/funded-wallet.ts`** — fresh wallet via faucet OR reuse
  a pre-funded wallet via `ADARA_E2E_PRIVATE_KEY`.
- **`test/e2e/happy-path.spec.ts`** — smoke (register only, always runs) +
  full cycle (create venture → fund → open task; requires Tier-2 wallet).
- **`test/e2e/README.md`** — full operator reference.
- **`.github/workflows/e2e.yml`** — runs smoke on every push/PR, full cycle on
  manual dispatch or schedule.
- **`index.html`** — network config (lines ~583–613) is now **override-able**
  via `window.__ADARA_CONFIG__` or `<meta name="adara-config">`. Current
  Adara devnet behavior is preserved as the default. **No URL or address
  change is required to flip to Base Sepolia** — just set the override.
- **`config.base-sepolia.template.json`** — paste-ready config for after the
  Base Sepolia deploy.

### In `Adara Protocol` (main protocol repo)

- **`scripts/deploy-l2.ts`** — now honors `ADARA_USDC_ADDRESS` env. When set
  to a valid contract, that address is reused as the stablecoin; no MockERC20
  is deployed. When unset, behavior is unchanged (MockERC20 deployed).
- `hardhat.config.ts` already has `baseSepolia` and `arbitrumSepolia` network
  entries — they were pre-existing, I didn't need to add them.

---

## What only you can do

### 1. Get an RPC provider (15 min) — **blocks everything downstream**

Pick one, register, grab an API key:
- **Alchemy** — https://dashboard.alchemy.com — free tier includes Base Sepolia,
  300M compute units/month.
- **QuickNode** — https://dashboard.quicknode.com — free tier is thinner.
- **Base public RPC** — `https://sepolia.base.org` — zero setup, but rate-limited
  (can run the E2E tests; probably not comfortable for a 10-tester cohort).

Produces: an RPC URL like `https://base-sepolia.g.alchemy.com/v2/<api-key>`.

Store it as:
- **Local deploy** — add `BASE_SEPOLIA_RPC_URL` via `npx hardhat keystore set` in
  the main protocol repo (it's already referenced as a `configVariable`).
- **GitHub Actions** — add repo secret `ADARA_RPC_URL` on `adara-onboard`.

### 2. Fund the deployer wallet (10 min) — **blocks deploy**

The deploy script needs a wallet with ~0.1 Base Sepolia ETH. Two options:

**a) New dedicated deploy wallet (recommended):**
```bash
# Generate (in main protocol repo)
node -e "const w = require('ethers').Wallet.createRandom(); console.log('PK:', w.privateKey); console.log('ADDR:', w.address);"
# Fund it from a public faucet:
#   https://www.alchemy.com/faucets/base-sepolia   (most reliable)
#   https://coinbase.com/faucets/base-ethereum-sepolia-faucet
#   https://faucets.chain.link/base-sepolia
```

**b) Reuse an existing wallet** — e.g. your Mac B MetaMask. Export the
private key into `L2_DEPLOYER_KEY` via `npx hardhat keystore set`. Fund from
the same faucet.

Store the key as:
- **Local deploy** — `npx hardhat keystore set L2_DEPLOYER_KEY` (already referenced
  in `hardhat.config.ts`).

You'll also want ~1000 USDC from https://faucet.circle.com for the deployer
wallet itself, so the deploy script can perform initial treasury config.
(Circle faucet: 1000 USDC/day per address.)

### 3. Run the deploy (5 min command, ~10 min chain time)

```bash
cd ~/Projects/Adara\ Protocol/

# Circle testnet USDC address for Base Sepolia:
export ADARA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

npx hardhat run scripts/deploy-l2.ts --network baseSepolia
```

Expected output: `deployments/baseSepolia-{timestamp}.json` (or
`deployments/base-sepolia.json` depending on existing convention) with the
full V1 + V2 + governance address set.

**Sanity check the deploy** before proceeding:
```bash
# Verify chainId
cast chain-id --rpc-url $BASE_SEPOLIA_RPC_URL
# expect: 84532

# Verify AgentRegistry has code
cast code <AgentRegistry-addr> --rpc-url $BASE_SEPOLIA_RPC_URL | head -c 20
# expect: 0x60806040... (bytecode)

# Sanity-spend a test USDC transfer
cast send 0x036CbD53842c5426634e7929541eC2318f3dCF7e "transfer(address,uint256)" <your-addr> 1000000 \
  --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $L2_DEPLOYER_KEY
# expect: tx hash, confirmed
```

### 4. Wire the onboard dApp to the new deploy (10 min)

After the deploy completes, edit `adara-onboard/index.html`. Above the main
`<script>` block (around line 575), insert **one** of these:

**Option A — inline `<script>` (simplest):**
```html
<script>
window.__ADARA_CONFIG__ = {
  rpcUrl: "https://sepolia.base.org",  // or your Alchemy URL
  chainId: 84532,
  chainIdHex: "0x14A34",
  chainName: "Base Sepolia",
  usdcDecimals: 6,                       // real USDC is 6 decimals, not 18
  contracts: {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    AgentRegistry: "0x<from-deploy-output>",
    VentureFactoryV2: "0x<from-deploy-output>"
  }
};
</script>
```

**Option B — fill in `config.base-sepolia.template.json` and emit a `<meta>` tag:**
```html
<meta name="adara-config" content='{"rpcUrl":"https://sepolia.base.org", ...}'>
```

Commit, push, and Cloudflare Pages auto-deploys (~30s).

Then run the E2E against the new chain:
```bash
cd ~/Projects/adara-onboard/
export ADARA_RPC_URL=https://sepolia.base.org
export ADARA_CHAIN_ID=84532
export ADARA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
export ADARA_AGENT_REGISTRY=0x<from-deploy-output>
export ADARA_E2E_PRIVATE_KEY=0x<Tier-2-wallet-key>
# (ADARA_FAUCET_CODE not needed — Base Sepolia has public faucet)

npm install
npx playwright install --with-deps chromium
npm run test:e2e -- --grep "smoke"
```

Expect: green smoke, Tier-0 registration succeeds on Base Sepolia.

### 5. Open the cohort (ongoing)

Post in 2–3 crypto-native communities:

> "Adara Protocol tester program now open on Base Sepolia. No faucet
> paperwork — just add your wallet, grab 0.05 Base Sepolia ETH from
> Alchemy or Coinbase's faucet and 100 USDC from faucet.circle.com, and
> walk the 7-step flow at https://onboard.adara.network.
> Join the Discord: https://discord.gg/UBVGRdsD. Report issues at
> https://github.com/Adara-Network/adara-v3-tester-release/issues."

---

## Estimated time budget

| Step | Your time | Wall-clock |
|------|:---------:|:----------:|
| 1. RPC provider | 15 min | 15 min |
| 2. Fund wallet | 10 min | 10 min (depends on faucet) |
| 3. Deploy | 5 min active + waiting | 30-60 min |
| 4. Wire onboard | 10 min | 10 min (+ CF Pages build) |
| 5. Cohort announcement | 15 min | rolls on its own |
| **Total** | **~1 hour active work** | **~2 hours** |

The E2E test and CI will run green as soon as step 4 completes. You don't
need to touch my work.

---

## Things I did NOT do and why

- **Did not deploy to Base Sepolia.** Requires a wallet + funded ETH I don't
  control. You own this step.
- **Did not merge changes.** All work is in your local working tree on
  `adara-onboard` and `Adara Protocol`. Review with `git diff`, commit+push
  when you're ready.
- **Did not set up GitHub Actions secrets.** GH secrets UI is browser-OAuth
  and can't be automated from a terminal session. You add them at
  https://github.com/Adara-Network/adara-onboard/settings/secrets/actions
  after this handoff — required keys listed in `test/e2e/README.md`.
- **Did not run the E2E tests.** Requires `npm install` + Playwright browser
  downloads (~500MB). Fine to do locally when you sit down — takes 2 min.
- **Did not write a cross-wallet (second-agent) E2E spec.** The happy-path
  spec has a TODO annotation. Easy follow-up once the first Tier-2 wallet
  is validated.

---

## Risks I want you to read

1. **Circle testnet USDC has 6 decimals.** The dApp's current config defaults
   to 18 (because MockERC20 was 18-decimal). My template sets it to 6
   correctly, but **verify the dApp's arithmetic paths** — search
   `USDC_DECIMALS` in `index.html` and confirm every `parseUnits` /
   `formatUnits` call uses the constant, not a hardcoded `18`.

2. **Tier-2 bootstrap on Base Sepolia is a blank slate.** You'll need to
   bootstrap the first tester (same as you did on devnet via
   `scripts/bootstrap-tier2-for.ts`). The deploy script doesn't auto-bootstrap.

3. **Faucet service becomes optional.** `apps/faucet` isn't needed on Base
   Sepolia — testers self-fund from public faucets. Consider whether to keep
   it running for convenience (one-click USDC + ETH) or decommission it.

4. **The existing Besu devnet keeps running.** Services on the VPS still
   point at chainId 1981. This is deliberate — keep it as an internal fuzz
   + load-test lab. Don't decommission until Base Sepolia has been stable
   for 2+ weeks.
