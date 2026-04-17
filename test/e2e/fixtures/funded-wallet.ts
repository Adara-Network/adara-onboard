import { Wallet, JsonRpcProvider, Contract, formatEther, formatUnits } from "ethers";

/**
 * Produce a fresh wallet funded via the Adara faucet so each E2E run operates
 * on clean on-chain state (no duplicate-register collisions, no leftover
 * ventures). If ADARA_E2E_PRIVATE_KEY is set we use that wallet instead,
 * which is convenient for local development against a pre-funded account.
 */
export interface FundedWallet {
  privateKey: string;
  address: string;
  label: string;
  ethBalance: string;
  usdcBalance: string;
}

export interface FundOptions {
  rpcUrl: string;
  faucetUrl: string;
  faucetCode: string;
  usdcAddress: string;
  labelPrefix?: string;
}

const ERC20_BAL = ["function balanceOf(address) view returns (uint256)"];

export async function getOrFundWallet(opts: FundOptions): Promise<FundedWallet> {
  const provider = new JsonRpcProvider(opts.rpcUrl);

  // Reuse a pre-funded wallet if the operator provides one (fast local dev).
  const existing = process.env.ADARA_E2E_PRIVATE_KEY;
  if (existing) {
    const w = new Wallet(existing, provider);
    const ethBal = await provider.getBalance(w.address);
    const usdc = new Contract(opts.usdcAddress, ERC20_BAL, provider);
    const usdcBal = await usdc.balanceOf(w.address);
    return {
      privateKey: existing,
      address: w.address,
      label: `e2e-existing-${w.address.slice(2, 10)}`,
      ethBalance: formatEther(ethBal),
      usdcBalance: formatUnits(usdcBal, 18),
    };
  }

  // Fresh wallet path — requires faucet access.
  if (!opts.faucetCode) {
    throw new Error(
      "No wallet available. Set ADARA_E2E_PRIVATE_KEY to reuse a funded wallet, " +
        "or ADARA_FAUCET_CODE to mint a fresh one via the faucet.",
    );
  }

  const wallet = Wallet.createRandom().connect(provider);
  const label = `${opts.labelPrefix || "e2e"}-${Date.now()}-${wallet.address.slice(2, 8)}`;

  const resp = await fetch(`${opts.faucetUrl.replace(/\/$/, "")}/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: wallet.address, label, code: opts.faucetCode }),
  });
  if (!resp.ok) {
    throw new Error(`Faucet returned ${resp.status}: ${await resp.text()}`);
  }

  // Wait for both tx confirmations to settle into balance.
  for (let i = 0; i < 30; i++) {
    const eth = await provider.getBalance(wallet.address);
    const usdc = new Contract(opts.usdcAddress, ERC20_BAL, provider);
    const bal = (await usdc.balanceOf(wallet.address)) as bigint;
    if (eth > 0n && bal > 0n) {
      return {
        privateKey: wallet.privateKey,
        address: wallet.address,
        label,
        ethBalance: formatEther(eth),
        usdcBalance: formatUnits(bal, 18),
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Faucet funded but balances still zero after 30s for ${wallet.address}`);
}
