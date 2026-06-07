import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type Agent,
  clearSystem,
  computeTarget,
  discover,
  formatAgentLabel,
  formatDefaultLabel,
  loadManifest,
  pointAt,
  systemPath,
  systemState,
} from "../lib.js";

let tmp: string;
let cwd: string;
let home: string;

function writeAgent(dir: string, name: string, body = "prompt body\n") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), body);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-switcher-"));
  cwd = path.join(tmp, "project");
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(cwd, ".pi", "agents"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadManifest", () => {
  it("returns {} when missing", () => {
    expect(loadManifest(path.join(cwd, ".pi", "agents"))).toEqual({});
  });

  it("parses a valid manifest", () => {
    const dir = path.join(cwd, ".pi", "agents");
    fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({ pyrite: { desc: "hi" } }));
    expect(loadManifest(dir)).toEqual({ pyrite: { desc: "hi" } });
  });

  it("tolerates malformed JSON", () => {
    const dir = path.join(cwd, ".pi", "agents");
    fs.writeFileSync(path.join(dir, "agents.json"), "{ not json ]");
    expect(loadManifest(dir)).toEqual({});
  });

  it("ignores a JSON array (not an object map)", () => {
    const dir = path.join(cwd, ".pi", "agents");
    fs.writeFileSync(path.join(dir, "agents.json"), "[1,2,3]");
    expect(loadManifest(dir)).toEqual({});
  });
});

describe("discover", () => {
  it("finds project + home agents, project first, with descriptions", () => {
    const projAgents = path.join(cwd, ".pi", "agents");
    const homeAgents = path.join(home, ".pi", "agent", "agents");
    writeAgent(projAgents, "pyrite");
    writeAgent(projAgents, "analyst");
    writeAgent(homeAgents, "scribe");
    fs.writeFileSync(
      path.join(projAgents, "agents.json"),
      JSON.stringify({ pyrite: { desc: "twisted" } }),
    );

    const agents = discover(cwd, home);
    expect(agents.map((a) => `${a.scope}/${a.name}`)).toEqual([
      "project/analyst",
      "project/pyrite",
      "home/scribe",
    ]);
    expect(agents.find((a) => a.name === "pyrite")?.desc).toBe("twisted");
    expect(agents.find((a) => a.name === "analyst")?.desc).toBeUndefined();
  });

  it("excludes SYSTEM.md, APPEND_SYSTEM.md, dotfiles and non-.md", () => {
    const dir = path.join(cwd, ".pi", "agents");
    writeAgent(dir, "real");
    fs.writeFileSync(path.join(dir, "SYSTEM.md"), "x");
    fs.writeFileSync(path.join(dir, "APPEND_SYSTEM.md"), "x");
    fs.writeFileSync(path.join(dir, ".hidden.md"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    expect(discover(cwd, home).map((a) => a.name)).toEqual(["real"]);
  });

  it("returns [] when no agent dirs exist", () => {
    const bare = path.join(tmp, "bare");
    fs.mkdirSync(bare);
    expect(discover(bare, path.join(tmp, "nohome"))).toEqual([]);
  });
});

describe("computeTarget", () => {
  const piDir = "/x/.pi";
  it("relative target for project agents", () => {
    const a: Agent = { name: "p", file: "p.md", absPath: "/x/.pi/agents/p.md", scope: "project" };
    expect(computeTarget(piDir, a)).toBe("agents/p.md");
  });
  it("absolute target for home agents", () => {
    const a: Agent = { name: "h", file: "h.md", absPath: "/home/u/.pi/agent/agents/h.md", scope: "home" };
    expect(computeTarget(piDir, a)).toBe("/home/u/.pi/agent/agents/h.md");
  });
});

describe("label formatting", () => {
  it("marks active and shows description", () => {
    const a: Agent = { name: "pyrite", file: "pyrite.md", absPath: "/x", scope: "project", desc: "d" };
    expect(formatAgentLabel(a, true)).toContain("●");
    expect(formatAgentLabel(a, true)).toContain("— d");
    expect(formatAgentLabel(a, false)).toContain("○");
  });
  it("omits dash when no description", () => {
    const a: Agent = { name: "x", file: "x.md", absPath: "/x", scope: "home" };
    expect(formatAgentLabel(a, false)).not.toContain("—");
  });
  it("default label reflects active", () => {
    expect(formatDefaultLabel(true)).toContain("●");
    expect(formatDefaultLabel(false)).toContain("○");
  });
});

describe("systemState + swap lifecycle", () => {
  it("none when no SYSTEM.md", () => {
    expect(systemState(cwd).kind).toBe("none");
  });

  it("pointAt creates a symlink; systemState reports agent", () => {
    const dir = path.join(cwd, ".pi", "agents");
    writeAgent(dir, "pyrite", "SOUL\n");
    const [pyrite] = discover(cwd, home);
    const res = pointAt(cwd, pyrite);
    expect(res.target).toBe("agents/pyrite.md");
    expect(res.backedUp).toBeNull();

    const st = systemState(cwd);
    expect(st.kind).toBe("agent");
    expect(fs.realpathSync(systemPath(cwd))).toBe(fs.realpathSync(pyrite.absPath));
    expect(fs.readFileSync(systemPath(cwd), "utf-8")).toBe("SOUL\n");
  });

  it("clearSystem removes a symlink -> default", () => {
    const dir = path.join(cwd, ".pi", "agents");
    writeAgent(dir, "pyrite");
    pointAt(cwd, discover(cwd, home)[0]);
    const res = clearSystem(cwd);
    expect(res.removed).toBe(true);
    expect(res.backedUp).toBeNull();
    expect(systemState(cwd).kind).toBe("none");
  });

  it("backs up an unmanaged real file before removal", () => {
    fs.writeFileSync(systemPath(cwd), "hand written\n");
    expect(systemState(cwd).kind).toBe("file");
    const res = clearSystem(cwd);
    expect(res.removed).toBe(true);
    expect(res.backedUp).toBeTruthy();
    expect(fs.readFileSync(res.backedUp as string, "utf-8")).toBe("hand written\n");
    expect(systemState(cwd).kind).toBe("none");
  });

  it("backs up an unmanaged real file before linking an agent", () => {
    const dir = path.join(cwd, ".pi", "agents");
    writeAgent(dir, "pyrite", "SOUL\n");
    fs.writeFileSync(systemPath(cwd), "old prompt\n");
    const res = pointAt(cwd, discover(cwd, home)[0]);
    expect(res.backedUp).toBeTruthy();
    expect(fs.readFileSync(res.backedUp as string, "utf-8")).toBe("old prompt\n");
    expect(systemState(cwd).kind).toBe("agent");
    expect(fs.readFileSync(systemPath(cwd), "utf-8")).toBe("SOUL\n");
  });

  it("clearSystem on default is a no-op", () => {
    const res = clearSystem(cwd);
    expect(res.removed).toBe(false);
    expect(res.backedUp).toBeNull();
  });
});
