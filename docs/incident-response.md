# Incident Response

This document describes how incidents are triaged, who gets paged, how
escalation works, and how postmortems are run. For the symptoms/causes/steps
of individual alerts, see [`docs/runbook.md`](./runbook.md); for the
underlying alert rules, see [`docs/alerts.md`](./alerts.md).

## Severity levels

| Severity | Definition | Examples | Initial response |
| --- | --- | --- | --- |
| SEV1 | Full or near-full outage, or data loss/corruption. Customer-facing impact for most/all users. | API down, database unreachable, Stellar payments failing for all users | Page on-call immediately, all hands, incident channel opened |
| SEV2 | Significant degradation affecting a subset of users or a key feature. | High error rate on one route, notification delivery failures, queue backlog growing unbounded | Page on-call, work during business hours if off-hours impact is limited |
| SEV3 | Minor degradation or a non-critical feature impaired. Workaround available. | Elevated p95 latency within tolerance, single non-critical job type failing intermittently | Ticket created, fixed in next business day during normal work |

Severity may be re-assessed (up or down) as more information becomes
available — the initial page uses the best guess at the time.

## Escalation path and timing

1. **Alert fires** (see [`docs/alerts.md`](./alerts.md)) and pages the
   primary on-call engineer.
2. **Acknowledge within:**
   - SEV1: 5 minutes
   - SEV2: 15 minutes
   - SEV3: next business day (no page — routed to the team's ticket queue)
3. **If unacknowledged**, escalate to the secondary on-call after the
   acknowledge window elapses.
4. **If still unacknowledged** after the same window again, escalate to the
   engineering lead.
5. **For SEV1**, the on-call engineer opens an incident channel and posts
   status updates at least every 30 minutes until resolved, and loops in
   the engineering lead immediately regardless of acknowledgement time.

| Severity | Ack SLA | Update cadence | Escalates to secondary after |
| --- | --- | --- | --- |
| SEV1 | 5 min | every 30 min | 5 min |
| SEV2 | 15 min | every 60 min | 15 min |
| SEV3 | next business day | n/a | n/a |

## During the incident

- Follow the relevant section of [`docs/runbook.md`](./runbook.md) for the
  alert that fired.
- Keep changes and observations in the incident channel (or a shared doc if
  no chat tooling is wired up yet) so the postmortem has an accurate timeline.
- Mitigate first (rollback, restart, scale, disable a feature flag), then
  root-cause.

## Postmortem process

A postmortem is required for every SEV1 and any SEV2 that took longer than
one hour to resolve. It should be published within 3 business days of
resolution.

### Postmortem template

```markdown
# Postmortem: <short title>

- Date:
- Severity: SEV1 / SEV2 / SEV3
- Duration: <time detected> to <time resolved>
- Author(s):

## Summary
One paragraph: what happened and the customer impact.

## Timeline
- HH:MM — event
- HH:MM — event

## Root cause
What actually caused the incident (not just the trigger).

## Detection
How was it detected — alert, customer report, manual discovery?
How long between the incident starting and detection?

## Resolution
What actually fixed it.

## Impact
Who/what was affected, for how long, and any data/financial impact.

## Action items
| Action | Owner | Due date |
| --- | --- | --- |
|  |  |  |

## Lessons learned
What went well, what didn't, what was lucky.
```

Action items are tracked as issues and reviewed until closed — a postmortem
without follow-through on its action items is incomplete.
