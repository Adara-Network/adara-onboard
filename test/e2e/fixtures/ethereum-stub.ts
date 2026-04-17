/**
 * Injectable `window.ethereum` stub for Playwright E2E.
 *
 * The onboard dApp uses `new ethers.BrowserProvider(window.ethereum)` for all
 * on-chain interactions. In a real browser this points at MetaMask; here we
 * replace it with a stub backed by an ethers.Wallet + JsonRpcProvider so:
 *   - no wallet popup, fully deterministic
 *   - any eth_sendTransaction / eth_signTypedData / eth_chainId goes through
 *     the wallet we control
 *   - chainChanged / accountsChanged listeners are recorded but never fire,
 *     because the test drives state directly rather than waking events
 *
 * Injection pattern (in a Playwright test):
 *
 *     await context.addInitScript({
 *       path: require.resolve("./fixtures/ethereum-stub.inject.js"),
 *     });
 *
 * The compiled `inject.js` reads config from `window.__ADARA_E2E_CONFIG__`
 * which the Playwright test sets via addInitScript({ content: `window.__ADARA_E2E_CONFIG__ = ${JSON.stringify(cfg)}` }).
 */
export interface InjectConfig {
  privateKey: string; // 0x-prefixed hex
  rpcUrl: string;
  chainId: number; // decimal
}

/**
 * Stub body as a string — must be self-contained (no imports, no TS), because
 * it runs in the browser context. Depends only on the `ethers` UMD bundle that
 * the onboard dApp already loads from cdnjs.
 */
export const ETHEREUM_STUB_SOURCE = /* js */ `
(function () {
  // Wait for the ethers UMD to be available (the dApp loads it via <script>).
  // This stub runs in an init script, which fires before page scripts. If
  // ethers isn't loaded yet, we install a waiter that swaps in the stub
  // implementation once ethers resolves.
  var cfg = window.__ADARA_E2E_CONFIG__;
  if (!cfg) {
    console.warn("[e2e-stub] no __ADARA_E2E_CONFIG__; stub disabled");
    return;
  }

  var listeners = {};
  var pending = [];
  var real = null;

  function emit(event, arg) {
    (listeners[event] || []).forEach(function (fn) { try { fn(arg); } catch (_) {} });
  }

  function install() {
    if (!window.ethers) {
      setTimeout(install, 25);
      return;
    }
    var provider = new window.ethers.JsonRpcProvider(cfg.rpcUrl);
    var wallet = new window.ethers.Wallet(cfg.privateKey, provider);
    real = { provider: provider, wallet: wallet };

    // Flush queued requests
    var queued = pending; pending = [];
    queued.forEach(function (q) {
      dispatch(q.method, q.params).then(q.resolve, q.reject);
    });
  }
  install();

  function dispatch(method, params) {
    if (!real) {
      return new Promise(function (resolve, reject) {
        pending.push({ method: method, params: params, resolve: resolve, reject: reject });
      });
    }
    params = params || [];
    var p = real.provider, w = real.wallet;
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return Promise.resolve([w.address]);
      case "eth_chainId":
        return Promise.resolve("0x" + cfg.chainId.toString(16));
      case "net_version":
        return Promise.resolve(String(cfg.chainId));
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return Promise.resolve(null);
      case "personal_sign":
        // params: [message, address]
        return w.signMessage(
          typeof params[0] === "string" && params[0].startsWith("0x")
            ? window.ethers.getBytes(params[0])
            : params[0]
        );
      case "eth_signTypedData_v4": {
        // params: [address, jsonPayload]
        var payload = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        var types = Object.assign({}, payload.types);
        delete types.EIP712Domain;
        return w.signTypedData(payload.domain, types, payload.message);
      }
      case "eth_sendTransaction": {
        var tx = params[0] || {};
        var prepared = {
          to: tx.to,
          data: tx.data,
          value: tx.value ? window.ethers.toBigInt(tx.value) : 0n,
          gasLimit: tx.gas ? window.ethers.toBigInt(tx.gas) : undefined,
        };
        return w.sendTransaction(prepared).then(function (r) { return r.hash; });
      }
      default:
        // Anything else (eth_call, eth_getBlockByNumber, ...) passes through
        return p.send(method, params);
    }
  }

  var ethStub = {
    isMetaMask: false,
    isAdaraE2E: true,
    request: function (args) { return dispatch(args.method, args.params); },
    on: function (event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    removeListener: function (event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter(function (l) { return l !== fn; });
    },
    // Legacy helpers some libraries reach for
    enable: function () { return dispatch("eth_requestAccounts", []); },
  };

  Object.defineProperty(window, "ethereum", { value: ethStub, writable: false, configurable: false });
})();
`;
