# Postman Collection

This directory contains the Postman collection and local environment file for the HireSettle API.

| File | Purpose |
|------|---------|
| `hiresettle-api.postman_collection.json` | All API requests, organised by module |
| `hiresettle-local.postman_environment.json` | Environment variables for local development |

---

## Importing into Postman

### 1. Import the collection

1. Open Postman and click **Import** (top-left).
2. Select **File** and choose `hiresettle-api.postman_collection.json`.
3. Click **Import**. The collection **HireSettle API** will appear in the sidebar.

### 2. Import the environment

1. Click **Import** again.
2. Select `hiresettle-local.postman_environment.json`.
3. Click **Import**. The environment **HireSettle - Local** will appear in the Environments list.
4. Select **HireSettle - Local** from the environment dropdown (top-right corner).

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `baseUrl` | `http://localhost:3000` | Base URL of the running API server. Change this to your staging/production URL when testing against those environments. |
| `accessToken` | _(empty)_ | JWT access token. Set this after authenticating (see [Authenticating requests](#authenticating-requests) below). |
| `refreshToken` | _(empty)_ | JWT refresh token returned alongside `accessToken`. Used by the **Refresh Token** request in the Auth folder. |

---

## Starting the local server

Follow the [Quick Start](../../README.md#quick-start-docker-compose) instructions to bring up the backend. By default the server listens on port `3000`, matching the `baseUrl` default.

---

## Authenticating requests

Most endpoints require a bearer token. The Auth folder contains the full sign-up/sign-in flow:

1. **Register** — `POST /api/v1/auth/register` — create a new account. Supply `email`, `password`, and optionally `role` (`COMPANY`, `RECRUITER`, or `ARBITER`).
2. **Login** — `POST /api/v1/auth/login` — returns `accessToken` and `refreshToken`.
3. Copy the `accessToken` value and paste it into the `accessToken` environment variable.

All requests that require authentication use `{{accessToken}}` as the bearer token via the collection-level **Authorization** tab — you do not need to set it per-request.

When the access token expires, use the **Refresh Token** request (`POST /api/v1/auth/refresh`) to obtain a new pair, then update `accessToken` and `refreshToken` in the environment.

---

## Collection folders

| Folder | Description |
|--------|-------------|
| **Health Check** | `GET /health` — verify the server and database are up |
| **Auth** | Register, login, refresh, logout, profile, TOTP, password reset |
| **Engagements** | Create, list, update status, cancel, dispute |
| **Milestones** | Submit proof, confirm, resolve dispute |
| **Events** | Poll Stellar chain events |
| **Notifications** | List notifications, mark read, SSE stream |
| **Users** | View and update profile, delete account |
| **Admin** | Admin-only user management and data-deletion-request endpoints |
