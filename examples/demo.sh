#!/usr/bin/env sh
set -eu
: "${LIBREREWARD_API_KEY:?Set LIBREREWARD_API_KEY from tenant:create}"
BASE_URL="${LIBREREWARD_BASE_URL:-http://localhost:8080}"
curl --fail-with-body --silent --show-error "$BASE_URL/v1/rewards" \
  -H "Authorization: Bearer $LIBREREWARD_API_KEY" \
  -H "Idempotency-Key: demo-$(date +%Y%m%d)" \
  -H "Content-Type: application/json" \
  --data '{"amount":"KUDOS:1","description":"LibreReward demonstration","external_reference":"demo-opaque"}'
printf '\nOpen the claim_url from the response.\n'
