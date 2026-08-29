import { registerAs } from '@nestjs/config';
import { Networks } from '@stellar/stellar-sdk';

export type StellarNetwork = 'testnet' | 'mainnet';

interface StellarNetworkDefaults {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

const NETWORK_DEFAULTS: Record<StellarNetwork, StellarNetworkDefaults> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
  },
  mainnet: {
    rpcUrl: 'https://soroban-mainnet.stellar.org',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: Networks.PUBLIC,
  },
};

function resolveNetwork(value?: string): StellarNetwork {
  const network = (value ?? 'testnet').toLowerCase();

  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(
      `Invalid STELLAR_NETWORK "${value}". Expected "testnet" or "mainnet".`,
    );
  }

  return network;
}

export default registerAs('stellar', () => {
  const network = resolveNetwork(process.env.STELLAR_NETWORK);
  const defaults = NETWORK_DEFAULTS[network];

  return {
    network,
    rpcUrl: process.env.STELLAR_RPC_URL ?? defaults.rpcUrl,
    horizonUrl: process.env.STELLAR_HORIZON_URL ?? defaults.horizonUrl,
    networkPassphrase: defaults.networkPassphrase,
    contractAddress:
      process.env.SOROBAN_CONTRACT_ADDRESS ??
      process.env.HIRESETTLE_CONTRACT_ID,
  };
});
