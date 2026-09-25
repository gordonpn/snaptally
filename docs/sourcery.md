# Sourcery GitHub App Integration

Sourcery provides automated code review and refactoring suggestions for JavaScript, TypeScript, and Python.

## Installation and Authorization

Sourcery operates as a GitHub App that analyzes pull requests against configured quality metrics and refactoring patterns.

### 1. Install GitHub App

1. Visit the [Sourcery GitHub App page](https://github.com/apps/sourcery-ai) or [Sourcery on GitHub Marketplace](https://github.com/marketplace/sourcery).
2. Select the free tier for open-source repositories.
3. Choose **Install** (or **Configure** if previously installed on your account).
4. Grant repository access to this repository (`gordonpn/snaptally`).

### 2. Configuration

Sourcery detects `.sourcery.yaml` at the repository root automatically:

- **Path Exclusions**: Lockfiles (`pnpm-lock.yaml`, `package-lock.json`), dependency caches, and minified bundles are excluded from analysis.
- **Rule Sets**: Default refactoring, suggestions, and comments are enabled.
- **Quality Metrics**: Metric thresholds and duplicate clone detection are configured for minimal noise.

### 3. Usage on Pull Requests

Once authorized:

- Sourcery analyzes code changes on newly opened or synchronized pull requests.
- Line-level suggestions appear directly in the GitHub pull request review interface.
- To skip Sourcery analysis on a specific PR, attach the label `sourcery-ignore`.
