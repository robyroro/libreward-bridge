# External review package

Production approval requires named reviewers who are independent of the implementation author. Running automated checks or writing this package is not an independent review.

Tracking: use this standalone repository's public issue tracker once reviewers are engaged. Earlier private-application issues are intentionally not cited as public evidence. Issue tracking can arrange and evidence the work but does not approve it.

## Security review scope

- tenant and operator authentication, scope/role separation, rotation, revocation, and audit integrity;
- concurrent reward creation/claim start and daily-limit locking;
- unknown wallet outcomes, reconciliation, restart, expiry, and duplicate-purse prevention;
- claim token derivation/hash, provider URI encryption, key rotation, log redaction, and retention;
- webhook SSRF controls, DNS rebinding, redirects, signatures, retries, and response limits;
- container privileges, network boundaries, PostgreSQL roles/backups, wallet database serialization, and dependency/SBOM evidence.

Required evidence: commit SHA, threat model, OpenAPI, migration set, test logs, funded sandbox evidence, SBOM, dependency audit, secret scan, and a written report with severity, reproduction, owner, and disposition for every finding.

## Privacy review scope

- confirm no recipient identity, IP, fingerprint, advertising ID, cookie, or analytics data is required;
- trace public IDs, opaque tenant references, claim capability, provider transaction IDs, logs, metrics, audit events, backups, and webhook payloads;
- verify purpose limitation, access roles, configured retention, legal holds, deletion evidence, data-subject handling, and processor/subprocessor boundaries;
- determine whether tenant-supplied metadata can contain prohibited personal data and require contractual/schema controls.

## Legal/accounting decisions

A qualified reviewer must decide supported jurisdictions and currencies; operator/tenant roles and liability; safeguarding and insolvency treatment; KYC/AML/sanctions obligations; tax/accounting record periods; consumer terms; abandoned/expired rewards; correction/refund policy; incident notification; open-source obligations; and whether operating a funded wallet for third-party reward liabilities requires authorization.

## Sign-off record

| Gate | Reviewer | Date | Evidence URL | Decision |
| --- | --- | --- | --- | --- |
| Independent application/security review | Pending | — | — | Not approved |
| Independent privacy review | Pending | — | — | Not approved |
| Qualified legal/regulatory review | Pending | — | — | Not approved |
| Accounting/treasury approval | Pending | — | — | Not approved |
| Owner production decision | Pending | — | — | Not approved |

Repository readiness and grant eligibility do not equal production approval. Real money must remain disabled until every applicable row is approved and unresolved high/critical findings are closed. Independent review and remediation are proposed as a future NGI TALER milestone; completed approval is not represented as a prerequisite for submitting the R&D proposal.
