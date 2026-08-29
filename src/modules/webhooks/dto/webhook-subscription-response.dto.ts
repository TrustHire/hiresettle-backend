export class WebhookSubscriptionResponseDto {
  id: string;
  companyId: string;
  url: string;
  eventTypes: string[]; // empty = all events (#275)
  createdAt: Date;
}
