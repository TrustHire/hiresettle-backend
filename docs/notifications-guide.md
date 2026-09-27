# Notifications Guide

This guide covers how notifications are delivered, how users control them, and how
critical events can be escalated to additional channels.

## Delivery channels

Notifications are delivered over the following channels:

- **Email** — the default channel for all notification types.
- **SMS** — an optional channel for critical events only (see below).

## Notification types

Notification types are grouped by severity. Only **critical** types are eligible
for SMS delivery:

| Type | Severity | SMS eligible |
| --- | --- | --- |
| `dispute_opened` | critical | yes |
| `dispute_resolved` | critical | yes |
| `security_alert` | critical | yes |
| `payment_failed` | normal | no |
| `payout_completed` | normal | no |
| `weekly_summary` | normal | no |

Non-critical types are always delivered by email and can never be routed to SMS.

## Enabling SMS notifications

SMS delivery is opt-in and requires a verified phone number. A user cannot enable
SMS until their phone number has been verified:

1. The user adds a phone number in notification settings.
2. A verification code is sent to that number.
3. The user submits the code to confirm ownership.
4. Only after verification succeeds can SMS delivery be enabled.

If a phone number is changed, it must be verified again before SMS delivery
resumes. Unverified numbers are never used for delivery.

## Daily SMS cap

To prevent runaway costs and accidental spam, each user has a **per-user daily
SMS cap**. Once the cap is reached for the current day, further critical
notifications fall back to email for the remainder of the day. The cap resets at
the start of the next day.

## Provider configuration

SMS delivery is performed through a provider (for example, Twilio). Provider
credentials are configured through environment variables and are never stored in
the repository. When no provider is configured, SMS delivery is disabled and all
notifications continue to be delivered by email.

## Quiet hours

Quiet hours suppress non-critical notifications during a user-defined window.
Critical notifications (including those eligible for SMS) are not suppressed by
quiet hours.
