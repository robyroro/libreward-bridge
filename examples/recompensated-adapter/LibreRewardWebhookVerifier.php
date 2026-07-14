<?php

namespace LibreReward\Examples\Recompensated;

use RuntimeException;

/** Reference boundary only; the receiver must persist event IDs before applying state changes. */
final class LibreRewardWebhookVerifier
{
    public function verify(
        string $rawBody,
        string $timestamp,
        string $signature,
        string $eventId,
        ?int $now = null,
    ): array {
        $secret = (string) config('libreward.webhook_secret');
        if ($secret === '') {
            throw new RuntimeException('LibreReward webhook secret is not configured.');
        }
        if (! preg_match('/^evt_[A-Za-z0-9_-]+$/', $eventId)) {
            throw new RuntimeException('LibreReward event ID is invalid.');
        }
        if (! ctype_digit($timestamp) || abs(($now ?? time()) - (int) $timestamp) > 300) {
            throw new RuntimeException('LibreReward webhook timestamp is stale or invalid.');
        }

        $expected = 'v1='.hash_hmac('sha256', $timestamp.'.'.$rawBody, $secret);
        if (! hash_equals($expected, $signature)) {
            throw new RuntimeException('LibreReward webhook signature is invalid.');
        }

        $payload = json_decode($rawBody, true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($payload) || ($payload['id'] ?? null) !== $eventId) {
            throw new RuntimeException('LibreReward webhook event ID does not match its payload.');
        }

        return $payload;
    }
}
