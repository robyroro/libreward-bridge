# Licensing decision

Recommendation: AGPL-3.0-or-later for the server and a future standalone SDK after legal review. LibreReward may execute GPLv3+ GNU Taler wallet-core/CLI as a separate program; no upstream source is copied or linked into this tree. AGPL remains GPLv3-compatible and also requires network-service source availability, which supports the public-infrastructure goal.

Runtime NPM dependencies in the current lockfile are expected to be permissive. CI runs a production dependency allowlist, vulnerability audit, and CycloneDX SBOM. The optional CLI remains governed by upstream GPLv3+ terms. GNU Taler documentation references may be GPLv3+ or GFDL 1.3+ and are cited rather than copied.

This is an engineering review, not legal advice. The complete canonical AGPL-3.0 text is now present. Before a public tag, counsel/owner must approve the license, review generated SBOM/license output, and decide whether a permissively licensed SDK should be split into a separately distributed package that contains no GPL-derived code.
