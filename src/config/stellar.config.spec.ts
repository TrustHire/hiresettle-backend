import stellarConfig from './stellar.config';

describe('stellarConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_HORIZON_URL;
    delete process.env.SOROBAN_CONTRACT_ADDRESS;
    delete process.env.HIRESETTLE_CONTRACT_ID;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to testnet network settings', () => {
    expect(stellarConfig()).toMatchObject({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('uses mainnet network settings when STELLAR_NETWORK=mainnet', () => {
    process.env.STELLAR_NETWORK = 'mainnet';

    expect(stellarConfig()).toMatchObject({
      network: 'mainnet',
      rpcUrl: 'https://soroban-mainnet.stellar.org',
      horizonUrl: 'https://horizon.stellar.org',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    });
  });

  it('rejects unsupported STELLAR_NETWORK values', () => {
    process.env.STELLAR_NETWORK = 'futurenet';

    expect(() => stellarConfig()).toThrow(
      'Invalid STELLAR_NETWORK "futurenet"',
    );
  });

  it('prefers SOROBAN_CONTRACT_ADDRESS over the legacy contract id variable', () => {
    process.env.SOROBAN_CONTRACT_ADDRESS = 'CNEW';
    process.env.HIRESETTLE_CONTRACT_ID = 'COLD';

    expect(stellarConfig()).toMatchObject({
      contractAddress: 'CNEW',
    });
  });

  it('keeps legacy HIRESETTLE_CONTRACT_ID as a fallback', () => {
    process.env.HIRESETTLE_CONTRACT_ID = 'COLD';

    expect(stellarConfig()).toMatchObject({
      contractAddress: 'COLD',
    });
  });
});
