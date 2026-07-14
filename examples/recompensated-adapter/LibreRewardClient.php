<?php

namespace LibreReward\Examples\Recompensated;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/** Reference only: keep this outside the generic core and wire it only after owner approval. */
final class LibreRewardClient
{
    public function createApprovedWithdrawal(int $withdrawId, string $exactTalerAmount): array
    {
        if (! config('libreward.enabled', false) || ! config('libreward.sandbox_enabled', false)) {
            throw new RuntimeException('LibreReward sandbox payout is disabled.');
        }

        $baseUrl = (string) config('libreward.base_url');
        $apiKey = (string) config('libreward.api_key');
        $currency = strtoupper((string) config('libreward.currency', 'TESTKUDOS'));
        if ($baseUrl === '' || $apiKey === '') {
            throw new RuntimeException('LibreReward sandbox configuration is incomplete.');
        }
        if (! str_starts_with($exactTalerAmount, $currency.':')) {
            throw new RuntimeException('LibreReward amount must use the configured sandbox currency.');
        }

        return Http::baseUrl($baseUrl)
            ->withToken($apiKey)
            ->acceptJson()
            ->timeout(10)
            ->withHeaders(['Idempotency-Key' => 'recompensated-withdraw:'.$withdrawId.':v1'])
            ->post('/v1/rewards', [
                'amount' => $exactTalerAmount,
                'description' => 'Approved platform reward',
                'external_reference' => 'withdraw:'.$withdrawId,
            ])
            ->throw()
            ->json();
    }
}
