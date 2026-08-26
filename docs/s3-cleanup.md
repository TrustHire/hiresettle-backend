# S3 Cleanup and Presigned URL Configuration

## Overview

This document describes the S3 presigned URL expiry configuration and automated cleanup job that removes orphaned S3 objects.

## Problem Statement

Previously:
- Presigned URL expiry was hardcoded to 3600 seconds (1 hour) in `S3Service.getPresignedUrl()`
- No mechanism existed to clean up uploads that were presigned but never completed
- Orphaned files accumulated in S3 when uploads failed or were abandoned

## Solution

### 1. Configurable Presigned URL Expiry

Presigned URL expiry is now configurable via the `S3_PRESIGNED_URL_EXPIRY` environment variable.

**Environment Variables:**

```env
# How long presigned URLs remain valid (in seconds). Default: 3600 (1 hour)
# Valid range: 60 - 604800 (1 minute to 7 days)
S3_PRESIGNED_URL_EXPIRY=3600
```

**Implementation:**
- `S3Service` reads the expiry value from config on initialization
- The default can still be overridden per-call by passing the `expiresIn` parameter
- Validation ensures the value is between 60 seconds and 7 days

### 2. Automated Cleanup Job

A scheduled job (`S3CleanupService`) runs daily at 3:00 AM UTC to remove orphaned S3 objects.

**Environment Variables:**

```env
# Grace period (in hours) before orphaned uploads are deleted. Default: 24
# Valid range: 1 - 168 (1 hour to 7 days)
S3_CLEANUP_GRACE_PERIOD_HOURS=24
```

**How It Works:**

1. **Lists all S3 objects** in the following prefixes:
   - `avatars/` - User avatar uploads
   - `evidence/` - Dispute evidence uploads

2. **Filters by age**: Only considers objects older than the grace period (default 24 hours)

3. **Checks database references**:
   - For avatars: Checks if the S3 key appears in any `User.avatarUrl`
   - For evidence: Checks if the S3 path exists in `DisputeEvidence.s3Path`

4. **Deletes orphaned objects**: Removes S3 objects with no corresponding DB reference

**Schedule:** Runs daily at 3:00 AM UTC (configurable via `@Cron` decorator)

## Files Changed

### New Files

- **`src/common/s3/s3-cleanup.service.ts`**
  - Implements the cleanup job
  - Separate cleanup methods for avatars and evidence
  - Queries Prisma to get referenced S3 paths
  - Deletes orphaned objects older than grace period

### Modified Files

- **`src/common/s3/s3.service.ts`**
  - Added `defaultPresignedUrlExpiry` property read from config
  - Changed `getPresignedUrl()` to use configurable expiry (with optional override)
  - Added `listObjects()` - lists S3 objects with a prefix
  - Added `deleteObject()` - deletes a single S3 object
  - Added `objectExists()` - checks if an S3 object exists
  - Added imports for `ListObjectsV2Command`, `DeleteObjectCommand`, `HeadObjectCommand`

- **`src/common/s3/s3.module.ts`**
  - Added `S3CleanupService` to providers
  - Imported `PrismaModule` (required by cleanup service)

- **`src/app.module.ts`**
  - Added `S3Module` to imports to ensure cleanup service is registered globally

- **`src/config/env.validation.ts`**
  - Added validation for `S3_PRESIGNED_URL_EXPIRY` (60-604800 seconds, default 3600)
  - Added validation for `S3_CLEANUP_GRACE_PERIOD_HOURS` (1-168 hours, default 24)

- **`.env.example`**
  - Added `S3_PRESIGNED_URL_EXPIRY` with default and description
  - Added `S3_CLEANUP_GRACE_PERIOD_HOURS` with default and description

## Configuration

### Presigned URL Expiry

Adjust based on your upload workflow:
- **Short-lived (300-900s)**: For immediate uploads with retry logic
- **Standard (3600s)**: Default for most use cases
- **Extended (7200-14400s)**: For slow connections or large files

### Cleanup Grace Period

Adjust based on your upload patterns:
- **Short (1-6h)**: Aggressive cleanup, requires uploads to complete quickly
- **Standard (24h)**: Balanced approach (default)
- **Extended (48-168h)**: Conservative, allows for delayed/retry workflows

## Safety Considerations

1. **Grace Period**: Only objects older than the grace period are eligible for deletion
2. **Database Validation**: Objects are only deleted if they have no DB reference
3. **Logging**: All deletions are logged for audit purposes
4. **Error Handling**: Failures don't stop the job; errors are logged and job continues

## Monitoring

Watch for:
- Log entries: `Starting orphaned S3 uploads cleanup job...`
- Deletion counts: `Deleted X orphaned avatar(s)`, `Deleted X orphaned evidence file(s)`
- Total summary: `Cleanup completed. Deleted X orphaned objects`
- Errors: `Failed to cleanup orphaned S3 uploads: [error message]`

## Testing

To test the cleanup job manually:

```typescript
// In a test or admin endpoint
import { S3CleanupService } from './common/s3/s3-cleanup.service';

// Inject the service and call:
await s3CleanupService.cleanupOrphanedUploads();
```

To verify cleanup behavior:
1. Upload a file to S3 directly (without creating DB record)
2. Wait for grace period to elapse
3. Run the cleanup job
4. Verify the object was deleted

## Acceptance Criteria

✅ **Expiry duration is read from config, not hardcoded**
- `S3_PRESIGNED_URL_EXPIRY` env var controls default expiry
- Validated on startup (60-604800 seconds)
- Per-call override still supported

✅ **Cleanup job only removes objects older than the grace period with no DB reference**
- Job runs daily at 3:00 AM UTC
- Filters by `lastModified` date older than grace period
- Checks DB references before deletion
- Only deletes orphaned objects

## Future Enhancements

Consider adding:
- Metrics/stats tracking (total orphaned bytes recovered)
- Webhook notifications for large cleanup operations
- Admin API endpoint to trigger cleanup manually
- Support for additional S3 prefixes as new upload types are added
- Dry-run mode for testing cleanup logic
