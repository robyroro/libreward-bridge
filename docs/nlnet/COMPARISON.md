# Comparison and differentiation

This comparison uses current public project descriptions and is intended to support, not replace, the concise proposal answer.

| Effort | Primary direction and scope | LibreReward difference |
| --- | --- | --- |
| [GNU Taler merchant stack](https://docs.taler.net/) | A merchant accepts payments from customers. | An operator issues a fixed-value reward to a recipient. LibreReward does not implement checkout or a merchant backend. |
| [Taler plugin for Fastify](https://nlnet.nl/project/TALER-Fastify/) | Low-code Taler donations and payments for Fastify applications. | LibreReward happens to use Fastify internally but provides an outbound reward state machine, bearer claim, reconciliation and result webhooks. It should reuse rather than duplicate compatible generic work. |
| [GNU Taler Wallet ID Lookup Service](https://nlnet.nl/project/TALER-LookupService/) | Optional discovery of wallet addresses linked to digital identities for P2P payments. | LibreReward deliberately has no recipient directory or identity requirement; a short-lived bearer capability authorizes one reward. |
| [Taler in Liberapay](https://nlnet.nl/project/TALER-Liberapay/) | Adds Taler as a payment provider for recurring donations on one platform. | LibreReward is platform-neutral and handles one-time outbound incentives rather than incoming donations. |
| [Interledger interoperability inquiry](https://nlnet.nl/project/TALER-Interledger-study/) | Studies Taler interoperability with Interledger/Open Payments and Web Monetization. | LibreReward is a concrete Taler peer-push integration and operational lifecycle, not a payment-network interoperability study. |
| [Formbricks Community](https://github.com/formbricks/formbricks) | AGPL core for privacy-first surveys; its [webhook API](https://formbricks.com/docs/api-v2-reference/management-api--webhooks/get-a-webhook) supports `responseFinished` triggers. | The proposed adapter demonstrates a privacy-minimizing reward after completion while keeping response content and respondent identity out of LibreReward. Formbricks remains an example, not a required dependency. |

## Defensible novelty claim

LibreReward's contribution is the combination of an outbound operator-funded flow, recipient-anonymous bearer delivery, tenant-scoped creation idempotency, single-winner claim concurrency, explicit ambiguous-wallet reconciliation, liquidity guardrails, and signed completion webhooks behind a platform-neutral API. The proposal should not claim that peer-push payments, Taler integrations, Fastify plugins, survey platforms, or reward systems are individually novel.

## Evidence still sought

- A public GNU Taler maintainer response about the supported server-side wallet boundary and initiation idempotency.
- Feedback from Formbricks maintainers on whether a separate adapter, documented webhook recipe, or upstream contribution is preferred.
- At least three potential integrator/operator interviews during the funded task, published as anonymized requirements and findings.
