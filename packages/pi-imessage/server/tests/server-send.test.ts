import { describe, expect, it } from "vitest";
import { SEND_SCRIPT, SendError, sendMessage } from "../send.mjs";

type ExecCb = (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void;

function fakeExec(stderr: string, fail: boolean) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const fn = (cmd: string, args: string[], _opts: unknown, cb: ExecCb) => {
    calls.push({ cmd, args });
    cb(fail ? Object.assign(new Error("exit 1"), { code: 1 }) : null, "", stderr);
  };
  return { fn, calls };
}

describe("sendMessage", () => {
  it("invokes osascript with script + recipient + text as argv (no interpolation)", async () => {
    const { fn, calls } = fakeExec("", false);
    await sendMessage({ recipient: "agent@icloud.com", text: "✅ hi\n[mbp · repo]" }, fn as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("osascript");
    expect(calls[0].args).toEqual(["-e", SEND_SCRIPT, "agent@icloud.com", "✅ hi\n[mbp · repo]"]);
    expect(SEND_SCRIPT).toContain("on run argv");
    expect(SEND_SCRIPT).not.toContain("agent@icloud.com");
  });

  it("classifies TCC -1743 as AUTOMATION_NOT_AUTHORIZED", async () => {
    const { fn } = fakeExec("execution error: Not authorized to send Apple events to Messages. (-1743)", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.code).toBe("AUTOMATION_NOT_AUTHORIZED");
    expect(err.localDetail).toContain("-1743");
  });

  it("classifies missing iMessage account as MESSAGES_UNAVAILABLE", async () => {
    const { fn } = fakeExec("execution error: Messages got an error: Can’t get 1st account whose service type = iMessage. (-1728)", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err.code).toBe("MESSAGES_UNAVAILABLE");
  });

  it("classifies anything else as SEND_FAILED and keeps stderr out of message", async () => {
    const { fn } = fakeExec("some /Users/secret/path exploded", true);
    const err = await sendMessage({ recipient: "a@b.co", text: "x" }, fn as never).catch((e) => e);
    expect(err.code).toBe("SEND_FAILED");
    expect(err.message).not.toContain("/Users/secret");
    expect(err.localDetail).toContain("/Users/secret");
  });
});
