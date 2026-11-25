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

`just toolchain-install` runs `mise install`; `just toolchain-verify` checks the
installed executable versions and repository declarations. `just toolchain-parity`
checks declarations without installing workstation tools. CI runs the same check
through the unit suite. No credentials are needed.

For interactive development, follow mise's [shell activation instructions](https://mise.jdx.dev/cli/activate.html).
For example, add `eval "$(mise activate bash)"` to your Bash startup file and open
a new shell. Without activation, use [mise exec](https://mise.jdx.dev/cli/exec.html)
for each command, including `mise exec -- just dev`. Mise manages PATH; no
machine-specific PATH or environment values are required in the repository.

## Keeping versions aligned

- CI intentionally follows Node and pnpm major-version tracks in the shared
  `.github/actions/setup/action.yml`; workstation patches remain pinned exactly.
  Workflows must reuse that setup action rather than add separate tool versions.
- Node stays on the Node 22 major used by the shared setup action. Its exact patch
  must satisfy `package.json` engines (at least 22.18.0).
- pnpm stays on the CI major 10 and consumes lockfile format 9.0. Lockfile format
  numbers are not pnpm release numbers.
- Biome must exactly match `@biomejs/biome` in `package.json` and `pnpm-lock.yaml`.
  Package scripts resolve the dependency installed in `node_modules`; the standalone
  mise executable uses the same version.
- Local actionlint remains the official binary pinned to 1.7.7. CI uses the
  pinned reviewdog action's bundled fork, not that same executable. At action
  revision `ae857e78c1b42b3d0a49637181b09d3d56d402b4`, its
  [installer](https://github.com/reviewdog/action-actionlint/blob/ae857e78c1b42b3d0a49637181b09d3d56d402b4/scripts/install-actionlint.sh)
  selects `kjanat/actionlint` 1.17.1. This intentional provenance boundary is
  recorded in `scripts/toolchain-policy.json`; a changed action revision fails
  parity until its bundled version is inspected and the policy is updated.
  The existing `concurrency.queue` diagnostic exception remains unchanged.

The parity check verifies the current literal declaration format, including Biome
package, lockfile and schema agreement. It fails if version declarations stop
using that format; it does not implement a general TOML or YAML parser or download
upstream action sources during verification. Bundled-version metadata records a
source inspection, not a runtime attestation of the reviewdog container.

For an upgrade, edit the relevant exact pin, coordinate package and workflow
changes where necessary, then run `mise install`, `just toolchain-verify`,
`just lint`, and `just typecheck`. Review lockfile changes before committing.
If a pin is missing or downloads fail, check `mise doctor` and network access;
do not replace the exact version with `latest` to bypass the failure.

Infrastructure provisioning and OpenTofu are documented separately; this config
covers the four tools needed for the application development workflow.
