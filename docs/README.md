# Documentation

This directory contains the technical documentation for the HireSettle backend.

## Available Documents

| Document | Description |
|----------|-------------|
| [Caching](./caching.md) | Overview of the caching layer, Redis/in-memory backends, and usage. |
| [Rate Limiting](./rate-limiting.md) | Default throttle limits, per-route overrides, and Retry-After headers. |
| [Contributing](../CONTRIBUTING.md) | Branching strategy, commit conventions, and PR process. |
| [Database Schema](./database-schema.md) | Summary of all Prisma models, their purpose, key fields, and relationships. |
| [Deployment](./deployment.md) | Production deployment, build process, and migration ordering. |
| [Notifications Guide](./notifications-guide.md) | How in-app, email, and SSE notifications are delivered and configured. |
| [S3 Cleanup](./s3-cleanup.md) | Presigned URL configuration and the orphaned S3 object cleanup job. |
| [Secrets](./secrets.md) | Secret management, credential rotation procedures, and production injection. |
| [Security](./security.md) | Dependency vulnerability scanning and triage process. |
| [Stellar Integration](./stellar-integration.md) | Integration details with the Stellar blockchain, event polling, and contract interaction. |
| [Data Retention](./data-retention.md) | Retention windows, account deletion lifecycle, scheduled PII anonymization job, and env vars. |