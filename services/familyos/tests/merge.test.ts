import { describe, expect, it } from "vitest";
import { deepMerge } from "../src/config/merge";

describe("deepMerge", () => {
  it("recursively merges nested objects while replacing arrays", () => {
    const merged = deepMerge(
      {
        compaction: { enabled: true, reserveTokens: 16000 },
        extensions: ["root-extension"],
      },
      {
        compaction: { reserveTokens: 8000 },
        extensions: ["user-extension"],
      },
    );

    expect(merged).toEqual({
      compaction: { enabled: true, reserveTokens: 8000 },
      extensions: ["user-extension"],
    });
  });
});
