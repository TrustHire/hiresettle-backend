# On-Call Runbook

This document provides step-by-step instructions for handling alerts fired by the HireSettle backend.

## HighLatencyP95

### Symptoms
- p95 latency > 500ms for 5 minutes on one or more routes
- Users may experience slow response times or timeouts

### Likely Causes
- Database query performance issues
- Stellar RPC calls taking too long
- Network latency between services
- High CPU or memory pressure on the backend instance

### Resolution Steps
1. Check backend logs for slow requests or errors
2. Identify the affected route(s) from the alert
3. Check database query performance (using Prisma query logging or PostgreSQL pg_stat_statements
4. Check Stellar RPC response times (logs in StellarService
5. Verify backend resource usage (CPU, memory, disk I/O)
6. If a specific route is slow, optimize queries or add caching where appropriate

---

## HighErrorRate

### Symptoms
- Error rate > 1% for 2 minutes on one or more routes
- Users may experience failed requests

### Likely Causes
- Database errors (connection issues, query errors)
- Stellar RPC errors (timeouts, invalid transactions)
- Application bugs in specific features
- Dependency service outages

### Resolution Steps
1. Check backend logs for errors (focus on 5xx status codes)
2. Verify database connection status
3. Check Stellar RPC availability and response times
4. Roll back recent deployments if errors started after a deployment
5. Check for any recent changes that could be causing issues

---

## DeadLetterQueueDepth

### Symptoms
- Dead-letter queue depth > 10
- Events or messages not being processed

### Likely Causes
- Failed event/message processing failures
- Retries exhausted
- Invalid messages causing processing to fail repeatedly

### Resolution Steps
1. Inspect dead-letter queue contents to identify problematic messages
2. Check logs for errors during processing errors
3. Fix the root cause of the processing failure
4. Requeue valid messages from the dead-letter queue for reprocessing
5. Delete invalid messages or handle them appropriately

---

## DatabasePoolExhaustion

### Symptoms
- Database connection pool usage > 90%
- Requests may time out or fail to get a database connection

### Likely Causes
- Long-running database queries holding connections open
- Connection leaks in the application
- High traffic volume exceeding pool capacity

### Resolution Steps
1. Check active database connections (using PostgreSQL `SELECT * FROM pg_stat_activity;`
2. Identify and kill long-running idle or stuck queries
3. Check backend code for connection leaks (ensure Prisma transactions are properly committed/rolled back)
4. Increase connection pool size if necessary (in Prisma configuration)
5. Optimize database queries to reduce query duration
