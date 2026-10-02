// wallet-core's RPC socket (taler-util twrpc) exchanges one JSON value per newline-terminated line.
export class FrameTooLargeError extends Error {
  constructor() {
    super("wallet RPC line exceeds the configured limit");
  }
}

export class NdjsonDecoder {
  private parts: Buffer[] = [];
  private length = 0;

  constructor(private readonly maxLineBytes: number) {}

  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let rest = chunk;
    for (let index = rest.indexOf(0x0a); index >= 0; index = rest.indexOf(0x0a)) {
      this.append(rest.subarray(0, index));
      const line = Buffer.concat(this.parts, this.length).toString("utf8");
      this.parts = [];
      this.length = 0;
      if (line.trim()) lines.push(line);
      rest = rest.subarray(index + 1);
    }
    if (rest.length) this.append(rest);
    return lines;
  }

  private append(part: Buffer): void {
    this.length += part.length;
    if (this.length > this.maxLineBytes) throw new FrameTooLargeError();
    this.parts.push(part);
  }
}

export function encodeFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
