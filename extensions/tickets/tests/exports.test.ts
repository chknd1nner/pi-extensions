import { describe, expect, it } from "vitest";
import { shardPlan, setTicketField } from "../index";

describe("tickets exports", () => {
  it("exposes shardPlan and setTicketField for testing", () => {
    expect(typeof shardPlan).toBe("function");
    expect(typeof setTicketField).toBe("function");
  });
});
