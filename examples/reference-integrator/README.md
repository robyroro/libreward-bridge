# Generic reference integrator

This deliberately small example demonstrates the boundary an integrator owns: create a mock/valueless reward with a stable idempotency key, show the returned bearer claim URL only to the intended recipient, receive the raw webhook body, verify its signature/timestamp, and deduplicate its event ID before changing business state.

It is not a production server. Set test credentials through the environment; no keys are included. It has no analytics, recipient identity fields, wallet logic, or dependency on a particular platform. Run against `PROVIDER=mock` or a valueless sandbox only.

```sh
LIBREREWARD_BASE_URL=http://127.0.0.1:8080 \
LIBREREWARD_TEST_API_KEY='lrk_...redacted...' \
LIBREREWARD_WEBHOOK_SECRET='lwhsec_...redacted...' \
npx tsx examples/reference-integrator/server.ts
```

The example prints a claim URL to its local terminal and listens on `127.0.0.1:8090/webhook`. A real integrator must authenticate recipient delivery, store event IDs transactionally, enforce HTTPS, protect secrets, and avoid personal data in metadata/references.
