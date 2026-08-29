export class WebAuthnRegisterVerifyDto {
  // Stellar address identifying the user on this system
  stellarAddress: string;
  // Attestation response from the client (platform/roaming authenticator)
  attestationResponse: any;
}
