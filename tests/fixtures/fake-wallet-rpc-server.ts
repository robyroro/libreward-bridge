import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RpcRequest = { operation: string; id: string; args: Record<string, unknown> };
export type Reply =
  | { result: unknown }
  | { error: { code: number; hint: string } }
  | { raw: string }
  | { drop: true }
  | { disconnect: true };
export type Handler = (request: RpcRequest, connection: FakeConnection) => Reply | Promise<Reply>;

export class FakeConnection {
  constructor(readonly socket: Socket) {}

  notify(payload: unknown): void {
    this.socket.write(`${JSON.stringify({ type: "notification", payload })}\n`);
  }
}

/** Scriptable stand-in for `taler-wallet-cli advanced serve` speaking its NDJSON protocol. */
export class FakeWalletRpcServer {
  readonly requests: RpcRequest[] = [];
  readonly connections = new Set<FakeConnection>();
  private server: Server | undefined;

  constructor(
    readonly path: string,
    private readonly handler: Handler,
  ) {}

  static async start(handler: Handler): Promise<FakeWalletRpcServer> {
    const name = `libreward-test-${randomBytes(8).toString("hex")}`;
    const path =
      process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
    const instance = new FakeWalletRpcServer(path, handler);
    await instance.listen();
    return instance;
  }

  notifyAll(payload: unknown): void {
    for (const connection of this.connections) connection.notify(payload);
  }

  disconnectAll(): void {
    for (const connection of this.connections) connection.socket.destroy();
  }

  async close(): Promise<void> {
    this.disconnectAll();
    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
    if (process.platform !== "win32") rmSync(this.path, { force: true });
  }

  private listen(): Promise<void> {
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once("error", reject).listen(this.path, resolve);
    });
  }

  private accept(socket: Socket): void {
    const connection = new FakeConnection(socket);
    this.connections.add(connection);
    socket.on("close", () => this.connections.delete(connection));
    socket.on("error", () => undefined);
    let buffered = "";
    socket.setEncoding("utf8").on("data", (chunk: string) => {
      buffered += chunk;
      for (let index = buffered.indexOf("\n"); index >= 0; index = buffered.indexOf("\n")) {
        const request = JSON.parse(buffered.slice(0, index)) as RpcRequest;
        buffered = buffered.slice(index + 1);
        this.requests.push(request);
        void Promise.resolve(this.handler(request, connection)).then((reply) =>
          this.reply(socket, request, reply),
        );
      }
    });
  }

  private reply(socket: Socket, request: RpcRequest, reply: Reply): void {
    if ("drop" in reply) return;
    if ("disconnect" in reply) {
      socket.destroy();
      return;
    }
    if ("raw" in reply) {
      socket.write(reply.raw);
      return;
    }
    const envelope =
      "error" in reply
        ? { type: "error", operation: request.operation, id: request.id, error: reply.error }
        : { type: "response", operation: request.operation, id: request.id, result: reply.result };
    socket.write(`${JSON.stringify(envelope)}\n`);
  }
}
