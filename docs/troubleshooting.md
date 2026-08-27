# Troubleshooting Local Development

Common issues new contributors hit when following the [Quick Start](../README.md#quick-start-docker-compose) and how to fix them.

---

## Table of Contents

- [Prisma Issues](#prisma-issues)
  - [Migration Drift](#migration-drift)
  - [Client Not Generated](#client-not-generated)
  - [Database Connection Refused](#database-connection-refused)
- [Docker Compose Issues](#docker-compose-issues)
  - [Port Already in Use](#port-already-in-use)
  - [Container Fails to Start](#container-fails-to-start)
  - [Postgres Not Ready](#postgres-not-ready)
- [Environment Variable Issues](#environment-variable-issues)
  - [Missing Required Variables](#missing-required-variables)
  - [Invalid JWT_SECRET](#invalid-jwt_secret)
  - [Stellar Configuration Errors](#stellar-configuration-errors)
- [General Issues](#general-issues)

---

## Prisma Issues

### Migration Drift

**Symptoms:**
- `npx prisma migrate dev` shows "drift detected" or "your local changes are not reflected in the database"
- Database schema doesn't match `prisma/schema.prisma`

**Fix:**

```bash
# Option 1: Reset the database (WARNING: destroys all data)
npx prisma migrate reset

# Option 2: Create a new migration that brings the DB in sync
npx prisma migrate dev --create-only
# Then review the generated SQL in prisma/migrations/, and run:
npx prisma migrate deploy
```

**Prevention:**
- Always run `npx prisma migrate dev` (not `db push`) when changing the schema
- Never manually alter the database in production
- Pull latest changes before creating new migrations

### Client Not Generated

**Symptoms:**
- `Cannot find module '@prisma/client'`
- TypeScript errors about Prisma types

**Fix:**

```bash
npx prisma generate
npm run build
```

### Database Connection Refused

**Symptoms:**
- `P1001: Can't reach database server`
- `Connection refused`

**Fix:**
1. Verify Postgres is running:
   ```bash
   docker compose ps
   ```
2. Check `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql://hiresettle:password@localhost:5432/hiresettle_db
   ```
3. If using Docker, ensure the port matches:
   ```bash
   docker compose up -d postgres
   ```

---

## Docker Compose Issues

### Port Already in Use

**Symptoms:**
- `Bind for 0.0.0.0:5432 failed: port is already allocated`
- `Error starting userland proxy: Bind for 0.0.0.0:3000: address already in use`

**Fix:**

```bash
# Find the process using the port
lsof -i :5432
# or
lsof -i :3000

# Kill the process
kill -9 <PID>

# OR: Change the port in docker-compose.yml
ports:
  - "5433:5432"  # Map to a different host port
```

**Alternative:** Update your `.env` file:
```bash
PORT=3001  # Use a different port for the API
```

### Container Fails to Start

**Symptoms:**
- Container exits immediately after starting
- `docker compose logs` shows errors

**Fix:**

```bash
# Check container logs
docker compose logs postgres
docker compose logs api

# Common fixes:
# 1. Rebuild the image
docker compose build --no-cache api

# 2. Check .env file exists and has required values
cat .env

# 3. Verify DATABASE_URL is set correctly
grep DATABASE_URL .env
```

### Postgres Not Ready

**Symptoms:**
- `api` container fails with "connection refused"
- Prisma errors about database not being ready

**Fix:**

The `docker-compose.yml` includes a healthcheck for Postgres. If the API still can't connect:

```bash
# Wait for Postgres to be healthy
docker compose up -d postgres
# Wait a few seconds, then start the API
docker compose up -d api

# Or restart both
docker compose restart
```

---

## Environment Variable Issues

### Missing Required Variables

**Symptoms:**
- `NestApplication: Required environment variable "XXX" is missing`
- App crashes on startup with configuration errors

**Fix:**

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Fill in all required values (marked with **Yes** in README):
   ```bash
   # Minimum required for local development:
   JWT_SECRET=<run: openssl rand -base64 32>
   DATABASE_URL=postgresql://hiresettle:password@localhost:5432/hiresettle_db
   STELLAR_NETWORK=testnet
   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
   HIRESETTLE_CONTRACT_ID=<your-contract-id>
   STELLAR_SECRET_KEY=<your-stellar-secret>
   ALLOWED_TOKENS=[{"address":"...","symbol":"USDC","decimals":7}]
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   S3_ACCESS_KEY_ID=your-access-key
   S3_SECRET_ACCESS_KEY=your-secret-key
   S3_REGION=us-east-1
   S3_BUCKET=your-bucket
   ```

### Invalid JWT_SECRET

**Symptoms:**
- `JWT secret must be at least 32 characters`
- Auth tokens fail to verify

**Fix:**

```bash
# Generate a strong secret
openssl rand -base64 32

# Add the output to .env
JWT_SECRET=<paste-output-here>
```

### Stellar Configuration Errors

**Symptoms:**
- `Failed to connect to Stellar RPC`
- `Contract not found`

**Fix:**

1. Verify `STELLAR_NETWORK` is set to `testnet`
2. Check RPC URL is reachable:
   ```bash
   curl https://soroban-testnet.stellar.org
   ```
3. Ensure `HIRESETTLE_CONTRACT_ID` is a valid Stellar contract address (starts with `C`)
4. Verify `STELLAR_SECRET_KEY` is a valid Stellar secret key (starts with `S`)

---

## General Issues

### Node Version Mismatch

**Symptoms:**
- `SyntaxError: Unexpected token '?'` or similar parsing errors

**Fix:**

```bash
# Check Node version
node --version

# Should be v20.x (as specified in Dockerfile)
nvm install 20
nvm use 20
```

### Port Conflicts After Update

**Symptoms:**
- Services won't start after pulling new changes

**Fix:**

```bash
# Stop all containers and remove volumes
docker compose down -v

# Start fresh
docker compose up -d
```

---

## Getting Help

If you're still stuck:

1. Check the [README.md](../README.md) for the full Quick Start guide
2. Search [existing issues](https://github.com/TrustHire/hiresettle-backend/issues) on GitHub
3. Open a new issue with:
   - What you were trying to do
   - The exact error message
   - Your environment (OS, Node version, Docker version)
   - Contents of `.env` (with secrets redacted)
