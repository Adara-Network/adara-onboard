/* 2026-05-05 polish pass: extracted from inline <script> in index.html.
 * Network config resolution preserved exactly — config-driven chains
 * with three precedence layers (window override, <meta> tag, defaults).
 *
 * Designer note: the visual layer can read runtime chain info from
 * `getConfig().chainName` and friends without touching this file.
 */

export interface AdaraContracts {
  USDC: string;
  AgentRegistry: string;
  VentureFactoryV2: string;
}

export interface AdaraConfig {
  rpcUrl: string;
  apiUrl: string;
  chainId: number;
  chainIdHex: string;
  chainName: string;
  usdcDecimals: number;
  contracts: AdaraContracts;
  /** Optional WalletConnect project id. If absent, only injected wallets work. */
  walletConnectProjectId?: string;
}

const DEFAULTS: AdaraConfig = {
  rpcUrl: "https://devnet.adara.network",
  apiUrl: "https://api.adara.network",
  chainId: 1981,
  chainIdHex: "0x7BD",
  chainName: "Adara Devnet",
  usdcDecimals: 18,
  contracts: {
    USDC: "0xd757A66793c9559Cf3B1F2C1B1eA5CFC2C7b89A6",
    AgentRegistry: "0x0c9c3EDe7ed5dd285BD2E38ea3ae43bae3D87260",
    VentureFactoryV2: "0xD35DAd35AD967061f7AE78414a8c36bBb2B7beE5",
  },
};

declare global {
  interface Window {
    __ADARA_CONFIG__?: Partial<AdaraConfig>;
  }
}

let resolved: AdaraConfig | null = null;

export function getConfig(): AdaraConfig {
  if (resolved) return resolved;
  let override: Partial<AdaraConfig> = window.__ADARA_CONFIG__ ?? {};
  if (!override || Object.keys(override).length === 0) {
    const meta = document.querySelector('meta[name="adara-config"]');
    const content = meta?.getAttribute("content");
    if (content) {
      try { override = JSON.parse(content); } catch { override = {}; }
    }
  }
  resolved = {
    ...DEFAULTS,
    ...override,
    contracts: { ...DEFAULTS.contracts, ...(override.contracts ?? {}) },
  };
  return resolved;
}

/** ABI fragments used by the dApp. Kept tight to keep bundle size down. */
export const ABI = {
  erc20: [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address, uint256) returns (bool)",
  ],
  registry: [
    "function register(string, bytes32, bytes32[]) returns (uint256)",
    "function agentIdOf(address) view returns (uint256)",
    "function getTier(uint256) view returns (uint8)",
    "function getAgentInfo(uint256) view returns (tuple(address controller, uint8 tier, bool banned, uint8 slashCount, uint64 registeredAt, bytes32 attestHash))",
    "function reportBootstrapTask(address venture, uint256 taskId)",
  ],
  factory: [
    "function createVenture(tuple(address stablecoin, uint16 feeBps, uint8 requiredTierToJoin, uint8 requiredTierToCreate, uint8 mode, uint32 tsvVersion, bytes32 tsvWeightsHash, bytes32 ventureMetadataHash, string ventureURI, bool cuTransferable, bytes modeConfig, bool budgetVaultEnabled)) returns (uint256, address)",
    "function ventures(uint256) view returns (address)",
    "function nextVentureId() view returns (uint256)",
    "function ventureIdByAddress(address) view returns (uint256)",
    "event VentureCreatedV2(uint256 indexed ventureId, address indexed creator, address ventureInstance, address contributionUnit, address distributionVault, address verificationOracle, address budgetVault, uint8 mode, uint32 factoryVersion, uint16 feeBps, bytes32 metadataHash)",
  ],
};
