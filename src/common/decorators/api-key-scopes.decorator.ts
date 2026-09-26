import { SetMetadata } from '@nestjs/common';

/**
 * All valid API key scopes.
 *
 * Convention: `<resource>:<action>`
 *   read   = GET access to the resource
 *   write  = mutating access (POST / PATCH / PUT / DELETE)
 *   manage = full CRUD including administrative operations
 *
 * An empty scopes array on an ApiKey record means the key has unrestricted
 * access (backward-compatible with keys created before scopes were added).
 */
export enum ApiKeyScope {
  ENGAGEMENTS_READ    = 'engagements:read',
  ENGAGEMENTS_WRITE   = 'engagements:write',
  MILESTONES_READ     = 'milestones:read',
  MILESTONES_WRITE    = 'milestones:write',
  WEBHOOKS_MANAGE     = 'webhooks:manage',
  NOTIFICATIONS_READ  = 'notifications:read',
}

export const SCOPES_KEY = 'api_key_scopes';

/**
 * Declare which API key scope(s) are required to access a route.
 *
 * Usage:
 *   @RequireScopes(ApiKeyScope.ENGAGEMENTS_READ)
 *
 * JWT users are never affected — scope enforcement only applies when the
 * request was authenticated via an X-Api-Key header (authType === 'api_key').
 */
export const RequireScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);
