import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  FrameTooLargeError,
  NdjsonDecoder,
} from "../../src/providers/wallet-rpc/framing.js";

describe("NDJSON framing", () => {
  it("joins lines split across chunks and splits batched lines", () => {
    const decoder = new NdjsonDecoder(1024);
    expect(decoder.push(Buffer.from('{"a":'))).toEqual([]);
    expect(decoder.push(Buffer.from('1}\n{"b":2}\n{"c"'))).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoder.push(Buffer.from(":3}\n"))).toEqual(['{"c":3}']);
  });

  it("skips blank lines and keeps multi-byte characters intact across chunks", () => {
    const decoder = new NdjsonDecoder(1024);
    const bytes = Buffer.from('{"s":"ă"}\n\n');
    expect([...decoder.push(bytes.subarray(0, 7)), ...decoder.push(bytes.subarray(7))]).toEqual([
      '{"s":"ă"}',
    ]);
  });

  it("rejects a line longer than the limit even before its newline arrives", () => {
    const decoder = new NdjsonDecoder(8);
    expect(() => decoder.push(Buffer.from("123456789"))).toThrow(FrameTooLargeError);
  });

  it("encodes one JSON value per line", () => {
    expect(encodeFrame({ operation: "getVersion", id: "1", args: {} })).toBe(
      '{"operation":"getVersion","id":"1","args":{}}\n',
    );
  });
});
