<?php

return [
    'enabled' => env('LIBREREWARD_PAYOUT_ENABLED', false),
    'sandbox_enabled' => env('LIBREREWARD_SANDBOX_ENABLED', false),
    'base_url' => env('LIBREREWARD_BASE_URL'),
    'api_key' => env('LIBREREWARD_API_KEY'),
    'webhook_secret' => env('LIBREREWARD_WEBHOOK_SECRET'),
    'currency' => env('LIBREREWARD_CURRENCY', 'TESTKUDOS'),
];
