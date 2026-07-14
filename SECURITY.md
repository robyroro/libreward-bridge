# Security policy

LibreReward Bridge 0.1.x is pre-release software. Report vulnerabilities privately to the security contact configured by the deploying organization. Do not open a public issue containing a live claim URL, API key, webhook secret, wallet database, provider payload, or transaction secret.

Supported security fixes target the latest 0.1.x release. Operators should rotate affected tenant keys, webhook secrets, claim-hash secrets, and the funding wallet as appropriate. Claim URLs and `taler://pay-push` URIs are bearer capabilities.

See `docs/THREAT_MODEL.md` for the security model and residual risks.
