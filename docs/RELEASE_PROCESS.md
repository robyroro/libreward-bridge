# Release process

v0.1.0-alpha.1 is prepared but not published. A maintainer should work from a clean signed/tagged commit only after owner review.

1. Confirm package, `/version`, OpenAPI, changelog, and docs all use `0.1.0-alpha.1`.
2. Run `npm ci`, `npm run validate`, PostgreSQL integration tests, coverage, production dependency audit, license check, SBOM, secret scan, and container checks.
3. Review migrations/upgrade notes and verify no `.env`, wallet/database, bearer URI, token, key, or dump is tracked.
4. Build with `npm pack --dry-run`; inspect the file list and generated checksums. Build the container from the commit and record its digest.
5. Fill the external review index with commit SHA and evidence. For this alpha, keep every independent production sign-off pending.
6. Only after explicit owner approval, create an annotated `v0.1.0-alpha.1` tag and draft release notes. Do not publish npm/container artifacts from an untrusted pull request.

Artifact verification should compare SHA-256 checksums, CycloneDX SBOM, source commit, Node version, and container digest. See [Upgrade policy](UPGRADE_POLICY.md). This repository preparation did not publish or deploy anything.
