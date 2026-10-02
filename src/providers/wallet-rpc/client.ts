import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { walletRpcMalformedMessages } from "../../metrics.js";
import { encodeFrame, NdjsonDecoder } from "./framing.js";

export type WalletRpcErrorCode =
  | "wallet_rpc_unavailable"
  | "wallet_rpc_disconnected"
  | "wallet_rpc_timeout"
  | "wallet_rpc_protocol";

/** Transport failure. `wallet_rpc_unavailable` guarantees the request was never written. */
export class WalletRpcError extends Error {
  constructor(
    readonly code: WalletRpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** wallet-core answered with an `error` envelope. */
export class WalletCoreError extends Error {
  constructor(
    readonly talerCode: number | undefined,
    readonly hint: string,
  ) {
    super(hint);
  }
}

export type WalletRpcClientOptions = Readonly<{
  socketPath: string;
  requestTimeoutMs: number;
  maxLineBytes?: number;
  maxBackoffMs?: number;
}>;

export type ConnectionChange = "disconnected" | "reconnected";

type Pending = {
  socket: Socket;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

/** One persistent connection to `taler-wallet-cli advanced serve --unix-path …`. */
export class WalletRpcClient {
  private socket: Socket | undefined;
  private connecting: Promise<Socket> | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly notificationListeners = new Set<(notification: unknown) => void>();
  private readonly connectionListeners = new Set<(change: ConnectionChange) => void>();
  private failures = 0;
  private nextAttemptAt = 0;
  private everConnected = false;
  private closed = false;

  constructor(private readonly options: WalletRpcClientOptions) {}

  async request<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    const socket = await this.connect();
    const id = `lr-${randomBytes(12).toString("hex")}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WalletRpcError("wallet_rpc_timeout", "wallet-core request timed out"));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { socket, resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(encodeFrame({ operation, id, args }));
    });
  }

  onNotification(listener: (notification: unknown) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onConnectionChange(listener: (change: ConnectionChange) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.closed)
      return Promise.reject(
        new WalletRpcError("wallet_rpc_unavailable", "wallet RPC client closed"),
      );
    this.connecting ??= this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async open(): Promise<Socket> {
    const wait = this.nextAttemptAt - Date.now();
    if (wait > 0) await delay(wait);
    let socket: Socket;
    try {
      socket = await new Promise<Socket>((resolve, reject) => {
        const candidate = createConnection(this.options.socketPath);
        candidate.once("error", reject);
        candidate.once("connect", () => {
          candidate.off("error", reject);
          resolve(candidate);
        });
      });
    } catch {
      this.failures += 1;
      this.nextAttemptAt =
        Date.now() + Math.min(this.options.maxBackoffMs ?? 30_000, 100 * 2 ** this.failures);
      throw new WalletRpcError("wallet_rpc_unavailable", "wallet-core RPC endpoint is unavailable");
    }
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.attach(socket);
    if (this.everConnected) this.emitConnection("reconnected");
    this.everConnected = true;
    return socket;
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    // Do not keep the process alive only for an idle wallet connection.
    socket.unref();
    const decoder = new NdjsonDecoder(this.options.maxLineBytes ?? 1_048_576);
    socket.on("data", (chunk: Buffer) => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const line of lines) this.dispatch(line);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      for (const [id, pending] of this.pending) {
        if (pending.socket !== socket) continue;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(
          new WalletRpcError("wallet_rpc_disconnected", "wallet-core RPC connection closed"),
        );
      }
      if (!this.closed) this.emitConnection("disconnected");
    });
  }

  private dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      walletRpcMalformedMessages.inc();
      return;
    }
    if (typeof message !== "object" || message === null) {
      walletRpcMalformedMessages.inc();
      return;
    }
    const envelope = message as Record<string, unknown>;
    if (envelope.type === "notification") {
      for (const listener of this.notificationListeners) {
        try {
          listener(envelope.payload);
        } catch {
          // A failing listener must not break the connection for other callers.
        }
      }
      return;
    }
    if (
      (envelope.type !== "response" && envelope.type !== "error") ||
      typeof envelope.id !== "string"
    ) {
      walletRpcMalformedMessages.inc();
      return;
    }
    const pending = this.pending.get(envelope.id);
    if (!pending) return;
    this.pending.delete(envelope.id);
    clearTimeout(pending.timer);
    if (envelope.type === "response") {
      if ("result" in envelope) pending.resolve(envelope.result);
      else
        pending.reject(
          new WalletRpcError("wallet_rpc_protocol", "wallet-core response has no result"),
        );
      return;
    }
    const detail =
      typeof envelope.error === "object" && envelope.error !== null
        ? (envelope.error as Record<string, unknown>)
        : {};
    const code = typeof detail.code === "number" ? detail.code : detail.talerErrorCode;
    pending.reject(
      new WalletCoreError(
        typeof code === "number" ? code : undefined,
        typeof detail.hint === "string" ? detail.hint : "wallet-core error",
      ),
    );
  }

  private emitConnection(change: ConnectionChange): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(change);
      } catch {
        // Listener failures are isolated, as for notifications.
      }
    }
  }
}
