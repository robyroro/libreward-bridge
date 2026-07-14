import { describe, expect, it } from "vitest";
import { assertTransition } from "../../src/domain/state-machine.js";

describe("reward state machine", () => {
  it("accepts declared transitions", () =>
    expect(() => assertTransition("claimable", "claim_in_progress")).not.toThrow());
  it("rejects terminal and bypass transitions", () => {
    expect(() => assertTransition("claimed", "claimable")).toThrow();
    expect(() => assertTransition("created", "claimed")).toThrow();
  });
});
