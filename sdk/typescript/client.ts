import { verifyWebhookSignature as verifySignature } from "../../src/domain/webhook-signing.js";
import { projectVersion } from "../../src/version.js";

export type RewardStatus =
  | "created"
  | "claimable"
  | "claim_in_progress"
  | "claimed"
  | "expired"
  | "cancelled"
  | "failed"
  | "reconciliation_required";

export type CreateReward = {
  amount: string;
  description: string;
  external_reference?: string;
  metadata?: Record<string, string | number | boolean | null>;
  expires_at?: string;
};

export type Reward = {
  id: string;
  external_reference: string | null;
  amount: string;
  description: string;
  metadata: Record<string, string | number | boolean | null>;
  status: RewardStatus;
  expires_at: string;
  claimed_at: string | null;
  cancelled_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

export type CreatedReward = Reward & {
  claim_url: string | null;
  idempotent: boolean;
};

export type RewardEvent = {
  event_id: string;
  event_type: string;
  data: Record<string, unknown>;
  created_at: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
};

export type ClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export class LibreRewardApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class LibreRewardClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: ClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    if (!this.baseUrl.pathname.endsWith("/")) this.baseUrl.pathname += "/";
    if (!/^lrk_[A-Za-z0-9_-]{8,24}\.[A-Za-z0-9_-]{32,64}$/.test(this.apiKey))
      throw new Error("LibreReward tenant API key format is invalid");
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000)
      throw new Error("LibreReward timeout must be between 100 and 120000 milliseconds");
  }

  createReward(idempotencyKey: string, reward: CreateReward): Promise<CreatedReward> {
    return this.request("v1/rewards", {
      method: "POST",
      body: reward,
      headers: { "idempotency-key": idempotencyKey },
    });
  }

  getReward(rewardId: string): Promise<Reward> {
    return this.request(`v1/rewards/${encodeURIComponent(rewardId)}`);
  }

  cancelReward(rewardId: string): Promise<Reward> {
    return this.request(`v1/rewards/${encodeURIComponent(rewardId)}/cancel`, { method: "POST" });
  }

  regenerateClaim(rewardId: string): Promise<{ claim_url: string }> {
    return this.request(`v1/rewards/${encodeURIComponent(rewardId)}/regenerate-claim`, {
      method: "POST",
    });
  }

  listRewardEvents(
    rewardId: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ data: RewardEvent[]; next_cursor: string | null }> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    const suffix = query.size ? `?${query}` : "";
    return this.request(`v1/rewards/${encodeURIComponent(rewardId)}/events${suffix}`);
  }

  createWebhookEndpoint(input: {
    url: string;
    description?: string;
  }): Promise<WebhookEndpoint & { secret: string }> {
    return this.request("v1/webhook-endpoints", { method: "POST", body: input });
  }

  listWebhookEndpoints(): Promise<{ data: WebhookEndpoint[] }> {
    return this.request("v1/webhook-endpoints");
  }

  updateWebhookEndpoint(
    endpointId: string,
    input: { url?: string; description?: string; enabled?: boolean },
  ): Promise<WebhookEndpoint> {
    return this.request(`v1/webhook-endpoints/${encodeURIComponent(endpointId)}`, {
      method: "PATCH",
      body: input,
    });
  }

  async deleteWebhookEndpoint(endpointId: string): Promise<void> {
    await this.request(`v1/webhook-endpoints/${encodeURIComponent(endpointId)}`, {
      method: "DELETE",
      expectNoContent: true,
    });
  }

  testWebhookEndpoint(endpointId: string): Promise<{ event_id: string }> {
    return this.request(`v1/webhook-endpoints/${encodeURIComponent(endpointId)}/test`, {
      method: "POST",
    });
  }

  rotateWebhookSecret(endpointId: string): Promise<{ secret: string }> {
    return this.request(`v1/webhook-endpoints/${encodeURIComponent(endpointId)}/rotate-secret`, {
      method: "POST",
    });
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
      expectNoContent?: boolean;
    } = {},
  ): Promise<T> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      const init: RequestInit = {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          "user-agent": `LibreReward-TypeScript-SDK/${projectVersion}`,
          ...options.headers,
        },
        redirect: "error",
        signal,
      };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      response = await this.fetchImplementation(new URL(path, this.baseUrl), init);
    } catch (error) {
      if (signal.aborted)
        throw new LibreRewardApiError(0, "request_timeout", "LibreReward request timed out");
      throw new LibreRewardApiError(
        0,
        "network_error",
        error instanceof Error ? error.message : "LibreReward request failed",
      );
    }
    if (response.ok && (options.expectNoContent || response.status === 204)) return undefined as T;
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = isObject(body) && isObject(body.error) ? body.error : undefined;
      throw new LibreRewardApiError(
        response.status,
        typeof error?.code === "string" ? error.code : "unexpected_response",
        typeof error?.message === "string" ? error.message : "LibreReward request failed",
        typeof error?.request_id === "string" ? error.request_id : undefined,
        isObject(error?.details) ? error.details : undefined,
      );
    }
    if (!isObject(body))
      throw new LibreRewardApiError(
        response.status,
        "unexpected_response",
        "LibreReward returned malformed JSON",
      );
    return body as T;
  }
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  return verifySignature(
    input.secret,
    input.timestamp,
    input.rawBody,
    input.signature,
    input.nowSeconds ?? Math.floor(Date.now() / 1000),
    input.toleranceSeconds ?? 300,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
