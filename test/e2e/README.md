# adara-onboard E2E

Playwright-based end-to-end tests for the onboard dApp (`onboard.adara.network`).

## What this validates

A real browser loads the dApp, a scripted wallet handles every transaction (no
MetaMask popup), and the full tester flow is exercised end-to-end:

- **Smoke** (always runs): fresh faucet wallet → connect → register.
- **Full cycle** (requires a Tier-2 wallet): + create venture → fund budget → open task.
- **Cross-wallet cycle** (requires a second Tier-2 wallet): + claim → submit → verify → finalize → claimCash. *(Follow-up spec; not yet written.)*

The wallet is injected as a stub over `window.ethereum`, backed by
`ethers.Wallet` + `JsonRpcProvider`. No MetaMask, no Synpress — fully
deterministic, fast enough for CI on every push.

## Quick start

```bash
npm install
npm run test:e2e:install   # downloads Chromium (one-time)

# Option A: fresh wallet every run via faucet (slower, no state carryover)
export ADARA_FAUCET_CODE="<code from /root/faucet.env>"
npm run test:e2e

# Option B: reuse a pre-funded wallet (fast local dev)
export ADARA_E2E_PRIVATE_KEY="0x<private-key>"
npm run test:e2e

# Run with a visible browser (debugging)
npm run test:e2e:headed

# UI mode
npm run test:e2e:ui
```

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `ADARA_RPC_URL` | `https://devnet.adara.network` | JSON-RPC target |
| `ADARA_FAUCET_URL` | `https://faucet.adara.network` | Faucet API base |
| `ADARA_FAUCET_CODE` | *(unset)* | Required to mint fresh wallets; irrelevant if `ADARA_E2E_PRIVATE_KEY` is set |
| `ADARA_CHAIN_ID` | `1981` | Chain ID (flip to `84532` after Base Sepolia migration) |
| `ADARA_USDC_ADDRESS` | `0xd757A66793c9559Cf3B1F2C1B1eA5CFC2C7b89A6` | USDC contract |
| `ADARA_AGENT_REGISTRY` | `0x0c9c3EDe7ed5dd285BD2E38ea3ae43bae3D87260` | AgentRegistry contract |
| `ADARA_E2E_PRIVATE_KEY` | *(unset)* | If set, reuse this wallet; skip faucet |
| `ADARA_E2E_BASE_URL` | *(unset)* | If set, test against a remote URL (e.g. `https://onboard.adara.network`) instead of a local copy |

## Unlocking the full cycle

The full cycle test is **skipped by default** because `createVenture` requires
Tier 2 and a fresh wallet starts at Tier 0. To enable it:

1. Generate a tester key on the VPS:
   ```bash
   ssh root@178.128.227.110
   cd /root/cron-logs && ./gen-tester-key.sh e2e-ci
   ```
2. Bootstrap the wallet to Tier 2:
   ```bash
   cd /root/adara-protocol
   npx hardhat run scripts/bootstrap-tier2-for.ts --network devnet -- <address>
   ```
3. Add the private key to `ADARA_E2E_PRIVATE_KEY` (local `.env` or GitHub
   Actions secret).

## Target switch: devnet → Base Sepolia

When the protocol migrates to Base Sepolia, override in GitHub Actions secrets:

```
ADARA_RPC_URL=https://sepolia.base.org
ADARA_CHAIN_ID=84532
ADARA_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Circle testnet USDC
ADARA_AGENT_REGISTRY=0x<new-registry-addr>
# ADARA_FAUCET_* no longer needed — testers self-fund from Base Sepolia public faucet
```

Update `index.html` lines 583-594 with the new contract addresses; the test
spec itself doesn't change.

## Adding a test

Drop a new `*.spec.ts` in this directory. Use `injectStub(page, wallet)` for
wallet plumbing; the helper handles init-script timing so `window.ethereum`
is in place before the dApp loads.

## Known limitations

- **Tier 2 is required for most flows.** Fresh wallets can only register.
- **Faucet rate limit.** 3 per IP (lifetime). CI runs consume faucet quota;
  prefer `ADARA_E2E_PRIVATE_KEY` + a reusable wallet for frequent CI.
- **The stub is not MetaMask.** UX regressions that involve MetaMask-specific
  behavior (popup timing, reject flow) aren't caught. Add a Synpress-based
  spec in a separate file if that becomes important.
