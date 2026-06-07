import { describe, expect, it } from "vitest";
import ticketsExtension from "../index";

describe("tickets extension module", () => {
  it("default export is a registration function", () => {
    expect(typeof ticketsExtension).toBe("function");
  });
});
