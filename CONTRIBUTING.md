# Contributing to HireSettle Backend

Thank you for your interest in contributing! This document covers the branching strategy, PR process, commit conventions, and how to run tests.

## Commit Message Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org) specification for all commit messages. This allows for automated changelog generation and semantic versioning.

### Commit Message Format

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

### Type

The type must be one of:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries such as documentation generation

### Scope

The scope should be the name of the module or component affected (e.g., `auth`, `engagements`, `milestones`, `docs`, `deps`).

### Subject

The subject contains a succinct description of the change:

- Use the imperative, present tense: "change" not "changed" nor "changes"
- Don't capitalize the first letter
- No dot (.) at the end

### Example Commit Messages

```
feat(auth): add email/password login
fix(engagements): handle null values in job description
docs(readme): update installation instructions
style: format all TypeScript files with prettier
refactor(milestones): simplify timer calculation
```

## Branching Strategy

We use a trunk-based workflow off `main`:

| Branch pattern | Purpose |
|----------------|---------|
| `main` | Always deployable; protected — no direct pushes |
| `feature/<issue-number>-<short-slug>` | New feature or enhancement (e.g. `feature/85-mime-validation`) |
| `fix/<issue-number>-<short-slug>` | Bug fix (e.g. `fix/102-auth-race`) |
| `chore/<slug>` | Dependency updates, CI changes, non-functional work |
| `docs/<slug>` | Documentation-only changes |

Keep branches short-lived. If a feature takes more than a week, split it into smaller PRs.

---

## Pull Request Process

1. **Create a branch** from `main` using the naming convention above.
2. **Write focused commits** — one logical change per commit, following the convention below.
3. **Open a PR** against `main` with:
   - A clear title (`fix(auth): handle expired nonce correctly`)
   - A description explaining the *why*, not just the *what*
   - A reference closing the issue: `Closes #<number>` in the body
4. **Pass CI** — all tests must pass and coverage thresholds must be met before merging.
5. **Request a review** from at least one maintainer.
6. **Squash or rebase** as requested by the reviewer before merging — no merge commits.

---

## Running Tests

```bash
npm run test           # run all unit tests once
npm run test:watch     # watch mode for TDD
npm run test:cov       # generate coverage report (coverage/ directory)
```

Coverage thresholds (enforced by CI):
- Lines: 70 %
- Functions: 70 %
- Branches: 60 %

If adding a new service or controller, add a corresponding `*.spec.ts` file alongside it.

---

## Releasing a New Version

To release a new version:

1. Ensure your git working directory is clean (all changes committed).
2. Run:
   ```bash
   npm run release
   ```
   This will:
   - Bump the package version based on commit history
   - Update CHANGELOG.md with the latest changes
   - Create a new git tag for the release

3. Push the changes and tag:
   ```bash
   git push --follow-tags
   ```

### Pre-releases

To create a pre-release version (e.g., `v0.2.0-alpha.1`):

```bash
npm run release -- --prerelease alpha
```
