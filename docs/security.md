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

## Running npm audit locally

Before pushing, or when reproducing a CI failure, run the audit in your local checkout:

```bash
# Full audit report — shows every severity level with CVE details
npm audit

# Mirror what CI checks — exits non-zero only for high/critical findings
npm audit --audit-level=high

# See a compact one-line-per-package summary (useful for large trees)
npm audit --audit-level=high 2>&1 | grep -E "^(npm warn|high|critical)"
```

### Reading the output

Each finding shows:
- **Severity** (`low` / `moderate` / `high` / `critical`)
- **Package** — the vulnerable package and the version range affected
- **Path** — the dependency chain that pulls it in (e.g. `your-app > express > qs`)
- **Fix available** — whether a safe (non-breaking) fix exists

### Fixing vulnerabilities

```bash
# Auto-upgrade to the nearest non-breaking fix — safe to run first
npm audit fix

# Preview what would change without writing anything
npm audit fix --dry-run

# Allow semver-major upgrades (review breaking changes first!)
npm audit fix --force
```

After fixing, always re-run `npm audit --audit-level=high` and run the test
suite (`npm test`) to confirm nothing broke.

### When no fix is available yet

If `npm audit fix` reports "0 vulnerabilities fixed" and a CVE is still
present, you have two options:

1. **Pin an unaffected version** — if an older or newer version of the
   vulnerable package is safe, add a
   [`overrides`](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides)
   entry in `package.json`:

   ```json
   "overrides": {
     "vulnerable-pkg": ">=2.1.3"
   }
   ```

   Then run `npm install` to apply the override and `npm audit --audit-level=high`
   to confirm the finding is gone.

2. **Document an exception** — if the code path is genuinely unreachable or
   no upstream fix exists, open a GitHub issue, link it in your PR, and
   re-check weekly. Do **not** silence audits globally via `.npmrc`
   (`audit=false`); exceptions must be scoped and reviewed.

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
