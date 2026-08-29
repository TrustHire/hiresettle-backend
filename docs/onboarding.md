# Contributor Onboarding

Use this walkthrough to get from a fresh clone to your first pull request.

## 1. Clone the repository

Clone the repository and enter the project directory:

```bash
git clone https://github.com/TrustHire/hiresettle-backend.git
cd hiresettle-backend
```

## 2. Set up your environment

Install the project dependencies and create your local environment file:

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in the required development values. See the [README Quick Start](../README.md#quick-start-docker-compose) for the required variables and local service details.

## 3. Start Docker Compose

Start the local API and PostgreSQL services:

```bash
docker compose up
```

Keep this terminal running while you work. The API is available at `http://localhost:3000/api/v1` and Swagger is available at `http://localhost:3000/docs`.

## 4. Run the first migration

If you are using the manual setup path, or need to initialize a fresh local database, run:

```bash
npx prisma migrate dev --name init
npx prisma generate
```

The Docker Compose API service runs deployed migrations automatically. Do not create a second initial migration if the database has already been initialized.

## 5. Run the tests

Run the unit test suite before making changes and again before opening your PR:

```bash
npm run test
```

For the full test commands and coverage requirements, see [CONTRIBUTING.md](../CONTRIBUTING.md#running-tests).

## 6. Pick a good first issue

Browse the repository's [open `good first issue`s](https://github.com/TrustHire/hiresettle-backend/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22), choose one that matches your interests, and comment on it before starting so maintainers know you are working on it.

Before creating your branch or PR, read [CONTRIBUTING.md](../CONTRIBUTING.md) for branching, commit, review, and pull request conventions.

## Onboarding checklist

- [ ] Clone the repository and enter the project directory
- [ ] Install dependencies and create `.env`
- [ ] Fill in the required environment values
- [ ] Start Docker Compose
- [ ] Run or confirm the first Prisma migration
- [ ] Run the test suite
- [ ] Choose and claim a `good first issue`
- [ ] Read the contribution and pull request conventions