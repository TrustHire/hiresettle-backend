export class StellarError extends Error {
  constructor(
    message: string,
    public readonly code: StellarErrorCode,
    public readonly txHash?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StellarError';
    Object.setPrototypeOf(this, StellarError.prototype);
  }
}

export enum StellarErrorCode {
  KEYPAIR_NOT_CONFIGURED = 'KEYPAIR_NOT_CONFIGURED',
  SIMULATION_FAILED = 'SIMULATION_FAILED',
  SUBMISSION_FAILED = 'SUBMISSION_FAILED',
  CONFIRMATION_TIMEOUT = 'CONFIRMATION_TIMEOUT',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
}
