# Developer toolchain

The repository's [.mise.toml](../.mise.toml) pins Node.js, pnpm, Biome, and
actionlint. Install [mise](https://mise.jdx.dev/getting-started.html) using the
instructions for your operating system. Install [just](https://just.systems/man/en/)
separately if you want to use the Justfile recipes.

## First checkout

Review `.mise.toml` before trusting it. From the repository root:

```bash
mise trust
mise install
mise exec -- bash scripts/verify-toolchain.sh
mise exec -- pnpm install --frozen-lockfile
```

`just toolchain-install` runs `mise install`; `just toolchain-verify` runs the same
exact-version probes inside the mise environment. Verification exits nonzero if
any executable reports a version different from its declaration. No credentials
are needed for verification or local dependency installation.

For interactive development, follow mise's [shell activation instructions](https://mise.jdx.dev/cli/activate.html).
For example, add `eval "$(mise activate bash)"` to your Bash startup file and open
a new shell. Without activation, use [mise exec](https://mise.jdx.dev/cli/exec.html)
for each command, including `mise exec -- just dev`. Mise manages PATH; no
machine-specific PATH or environment values are required in the repository.

## Keeping versions aligned

- Node stays on the Node 22 major used by `.github/workflows/`. Its exact patch
  must satisfy `package.json` engines (at least 22.18.0).
- pnpm stays on the CI major 10 and consumes lockfile format 9.0. Lockfile format
  numbers are not pnpm release numbers.
- Biome must exactly match `@biomejs/biome` in `package.json` and `pnpm-lock.yaml`.
  Package scripts resolve the dependency installed in `node_modules`; the standalone
  mise executable uses the same version.
- actionlint is pinned to 1.7.7, matching the version tested for workflow validation.

For an upgrade, edit the relevant exact pin, coordinate package and workflow
changes where necessary, then run `mise install`, `just toolchain-verify`,
`just lint`, and `just typecheck`. Review lockfile changes before committing.
If a pin is missing or downloads fail, check `mise doctor` and network access;
do not replace the exact version with `latest` to bypass the failure.

Infrastructure provisioning and OpenTofu are documented separately; this config
covers the four tools needed for the application development workflow.
