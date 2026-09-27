export class WebhookSubscriptionResponseDto {
  id: string;
  companyId: string;
  url: string;
  eventTypes: string[]; // empty = all events (#275)
  createdAt: Date;
}

export class WebhookDeliveryLogEntryDto {
  id: string;
  event: string;
  status: string; // SUCCEEDED | FAILED | RESENT
  responseCode: number | null;
  attempts: number;
  errorMessage: string | null;
  resendCount: number;
  lastResendAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
