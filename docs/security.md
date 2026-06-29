# Dependency Vulnerability Scanning

This document describes how HireSettle backend detects and triages known
vulnerabilities in npm dependencies.

## Where scanning happens

- **CI (`.github/workflows/ci.yml`)** — every push and pull request runs
  `npm audit --audit-level=high`. The build fails if any **high** or
  **critical** severity vulnerability is present in the dependency tree.
- **Weekly scan (`.github/workflows/dependency-scan.yml`)** — every Monday
  06:00 UTC (and on-demand via `workflow_dispatch`), every branch in the
  repository is checked out and audited. If any branch has a high/critical
  vulnerability, a GitHub issue is opened automatically with the affected
  branch list and audit report artifacts attached, labeled `security` and
  `dependencies`.

## Triage process

1. **Acknowledge** — the issue opened by the weekly scan (or a CI failure)
   should be triaged within 1 business day.
2. **Assess severity and reachability** — run `npm audit --audit-level=high`
   locally and check whether the vulnerable code path is actually exercised
   by HireSettle (e.g. a vulnerable dev-only dependency is lower priority
   than one used in the request path).
3. **Patch**:
   - Prefer `npm audit fix` for non-breaking patch/minor upgrades.
   - For vulnerabilities only fixable via a major version bump, evaluate the
     breaking changes before upgrading and open a dedicated PR.
   - If no fix is published yet, check for a maintained alternative package.
4. **Exception** — if a vulnerability cannot be remediated immediately
   (no upstream fix, or the code path is genuinely unreachable), document the
   justification in the PR/issue and re-check weekly until a fix is
   available. Do not silence `npm audit` globally (e.g. via `.npmrc`
   `audit=false`) — exceptions must be scoped and reviewed, not blanket
   suppressions.
5. **Verify** — re-run `npm audit --audit-level=high` and confirm CI passes
   before closing the issue.

## SLA targets

| Severity | Acknowledge | Patch or documented exception |
| -------- | ----------- | ------------------------------ |
| Critical | Same day    | 2 business days                |
| High     | 1 business day | 5 business days             |
