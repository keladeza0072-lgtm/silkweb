# registry-data

Git-stored JSON manifests for Silk Web's verified component registry.

- `manifests/` holds one manifest per module version
  (`<id>-<version>.json`), validated by the strict schema in
  `packages/registry/src/manifest.ts`.
- Every manifest carries `verification.status`. Until passing executable
  tests are tied to the exact source hash, lockfile/dependency versions and
  runtime, the status stays `"unverified"` — currently true of all
  manifests here. No timestamps, test results, or source hashes are
  fabricated to upgrade it.

The deterministic loader (`packages/registry/src/loader.ts`) reads this
directory in sorted order and filters by exact version, stack,
capabilities, and dependencies.
