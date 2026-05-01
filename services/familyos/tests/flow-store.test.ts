import { describe, expect, it } from "vitest";
import { FlowStore } from "../src/flow-store";

describe("FlowStore", () => {
  it("returns undefined after expiry", async () => {
    const store = new FlowStore<{ kind: string }>(10);
    const token = store.create({ kind: "resume" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.get(token)).toBeUndefined();
  });
});
