# Documentation

This directory contains the technical documentation for the HireSettle backend.

## Available Documents

| Document | Description |
|----------|-------------|
| [Admin Guide](./admin-guide.md) | Admin-only API endpoints, required role, and admin user management. |
| [Alerts](./alerts.md) | Prometheus alerting rules for latency, error rate, queue depth, and pool exhaustion. |
| [Architecture](./architecture.md) | System diagram, NestJS module layout, and external service interactions. |
| [Billing](./billing.md) | Company billing routes, fee summaries, and CSV export. |
| [Caching](./caching.md) | Overview of the caching layer, Redis/in-memory backends, and usage. |
| [Contributing](../CONTRIBUTING.md) | Branching strategy, commit conventions, and PR process. |
| [Database Schema](./database-schema.md) | Summary of all Prisma models, their purpose, key fields, and relationships. |
| [Data Retention](./data-retention.md) | Retention windows, account deletion lifecycle, scheduled PII anonymization job, and env vars. |
| [Deployment](./deployment.md) | Production deployment, build process, and migration ordering. |
| [Environment Variables](./environment-variables.md) | Complete reference for every environment variable, validation rules, and defaults. |
| [Error Codes](./error-codes.md) | API error response envelope shape, status codes, and handling guidance. |
| [Glossary](./glossary.md) | Domain-specific terms: Engagement, Milestone, Escrow, Arbiter, Soroban, and more. |
| [Incident Response](./incident-response.md) | Incident severity levels, triage process, escalation path, and postmortem template. |
| [Load Testing](./load-testing.md) | k6 load and stress test suite, SLO targets, and how to interpret results. |
| [Monitoring](./monitoring.md) | Prometheus metrics emitted by the backend, labels, and example Grafana/PromQL queries. |
| [Multi-Currency](./multi-currency.md) | `ALLOWED_TOKENS` configuration for accepting multiple Stellar token contracts. |
| [Notifications Guide](./notifications-guide.md) | How in-app, email, and SSE notifications are delivered and configured. |
| [OpenAPI Guide](./openapi-guide.md) | Swagger UI access, OpenAPI decorator conventions, and schema generation. |
| [Performance](./performance.md) | k6 performance test scenarios, p95 SLO target, and how to add new scenarios. |
| [Rate Limiting](./rate-limiting.md) | Default throttle limits, per-route overrides, and Retry-After headers. |
| [Runbook](./runbook.md) | On-call runbook with step-by-step resolution for each Prometheus alert. |
| [S3 Cleanup](./s3-cleanup.md) | Presigned URL configuration and the orphaned S3 object cleanup job. |
| [Secrets](./secrets.md) | Secret management, credential rotation procedures, and production injection. |
| [Security](./security.md) | Dependency vulnerability scanning and triage process. |
| [Stellar Integration](./stellar-integration.md) | Integration details with the Stellar blockchain, event polling, and contract interaction. |
| [Data Retention](./data-retention.md) | Retention windows, account deletion lifecycle, scheduled PII anonymization job, and env vars. |
| [API Versioning](./api-versioning.md) | Current URL versioning convention and deprecation/sunset policy. |
| [Testing](./testing.md) | Testing layers, test layout, mocking conventions, commands, and coverage requirements. |
