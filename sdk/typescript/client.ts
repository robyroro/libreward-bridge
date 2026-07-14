export type CreateReward = {
  amount: string;
  description: string;
  external_reference?: string;
  metadata?: Record<string, string | number | boolean | null>;
  expires_at?: string;
};

export class LibreRewardClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async createReward(
    idempotencyKey: string,
    reward: CreateReward,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(new URL("/v1/rewards", this.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "idempotency-key": idempotencyKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(reward),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`LibreReward request failed (${response.status})`);
    return body;
  }
}
