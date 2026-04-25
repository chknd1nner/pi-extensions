import { describe, expect, it, vi } from "vitest";
import replacePrompt from "../index";

describe("replace-prompt extension", () => {
  it("registers a before_agent_start handler", () => {
    const on = vi.fn();
    replacePrompt({ on } as any);
    expect(on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
  });
});
