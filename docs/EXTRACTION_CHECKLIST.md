# Extraction checklist

- Copy only `libreward-bridge/` into a new repository and preserve history where possible.
- Search for private hostnames/IPs, emails, credentials, wallet files, and commercial provider names; public examples must remain platform-neutral.
- Confirm the canonical AGPL text and maintainer ownership/relicensing authority.
- Keep `.github/workflows/ci.yml` active, obtain a passing standalone run, and recreate branch protection; do not copy production deployment keys.
- Run lockfile install, formatter, lint, types, all PostgreSQL tests, OpenAPI validation, build, container/Compose clean migration, secret scan, production dependency audit, license report, and SBOM.
- Review Git history as well as the working tree for proprietary code/secrets.
- Add public security contact, governance/maintainer policy, issue/PR templates, release signing, provenance, and repository topics.
- Tag `v0.1.0-alpha.1` only with known limitations and no implication of production certification.
