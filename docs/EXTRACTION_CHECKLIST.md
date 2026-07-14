# Extraction checklist

- Copy only `libreward-bridge/` into a new repository and preserve history where possible.
- Search for `Recompensated`, private hostnames/IPs, emails, credentials, wallet files, and commercial provider names; only the generic reference document/example may mention the platform.
- Confirm the canonical AGPL text and obtain owner/legal approval.
- Copy `deployment/standalone-ci.yml` to `.github/workflows/ci.yml`, then recreate CI protection; do not copy production deployment keys.
- Run lockfile install, formatter, lint, types, all PostgreSQL tests, OpenAPI validation, build, container/Compose clean migration, secret scan, production dependency audit, license report, and SBOM.
- Review Git history as well as the working tree for proprietary code/secrets.
- Add public security contact, governance/maintainer policy, issue/PR templates, release signing, provenance, and repository topics.
- Tag `v0.1.0` only with known limitations and no implication of production certification.
