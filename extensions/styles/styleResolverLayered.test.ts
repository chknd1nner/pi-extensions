import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StyleResolver, type StyleRoot } from "./styleResolver";

type Warning = { id: string; message: string };

interface LayeredHarness {
  projectDir: string;
  homeDir: string;
  roots: StyleRoot[];
  warnings: Warning[];
  resolver: StyleResolver;
  writeProject(rel: string, text: string): void;
  writeHome(rel: string, text: string): void;
}

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeUnder(dir: string, rel: string, text: string): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function createLayered(): LayeredHarness {
  const projectDir = tempDir("pi-styles-project-");
  const homeDir = tempDir("pi-styles-home-");
  const roots: StyleRoot[] = [
    { dir: projectDir, scope: "project" },
    { dir: homeDir, scope: "home" },
  ];
  const warnings: Warning[] = [];
  const resolver = new StyleResolver(roots, (id, message) => warnings.push({ id, message }));
  return {
    projectDir,
    homeDir,
    roots,
    warnings,
    resolver,
    writeProject: (rel, text) => writeUnder(projectDir, rel, text),
    writeHome: (rel, text) => writeUnder(homeDir, rel, text),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("StyleResolver layered discovery", () => {
  it("lists styles from both roots tagged with their scope", () => {
    const h = createLayered();
    h.writeProject("a.md", "project a");
    h.writeHome("b.md", "home b");

    expect(h.resolver.listStyles()).toEqual([
      { name: "a", source: "file", scope: "project", reserved: false, label: "a" },
      { name: "b", source: "file", scope: "home", reserved: false, label: "b" },
    ]);
  });

  it("project entries silently shadow same-named home entries", () => {
    const h = createLayered();
    h.writeProject("concise.md", "project concise");
    h.writeHome("concise.md", "home concise");

    const list = h.resolver.listStyles();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "concise", scope: "project" });
    expect(h.warnings).toEqual([]); // shadowing is the whole point — no warning
  });

  it("resolveStyleContent returns the first root's file (project wins)", () => {
    const h = createLayered();
    h.writeProject("concise.md", "PROJECT TEXT");
    h.writeHome("concise.md", "HOME TEXT");

    const resolved = h.resolver.resolveStyleContent("concise", "claude-sonnet-4-5");
    expect(resolved?.rawText).toBe("PROJECT TEXT");
    expect(resolved?.file.startsWith(h.projectDir)).toBe(true);
  });

  it("falls through to home when project lacks the style", () => {
    const h = createLayered();
    h.writeHome("concise.md", "HOME TEXT");

    const resolved = h.resolver.resolveStyleContent("concise", "claude-sonnet-4-5");
    expect(resolved?.rawText).toBe("HOME TEXT");
    expect(resolved?.file.startsWith(h.homeDir)).toBe(true);
  });

  it("variant lookup stays inside the winning root (no cross-root variant scavenging)", () => {
    const h = createLayered();
    h.writeProject("thought/default.md", "project default");
    // Variant only exists in home — must NOT be picked up because project won the name.
    h.writeHome("thought/default.md", "home default");
    h.writeHome("thought/claude-sonnet-4-5.md", "home claude variant");

    const resolved = h.resolver.resolveStyleContent("thought", "claude-sonnet-4-5");
    expect(resolved?.rawText).toBe("project default");
    expect(resolved?.file.startsWith(h.projectDir)).toBe(true);
  });

  it("project _config.json rule overrides home rule for the same model", () => {
    const h = createLayered();
    h.writeProject("project-style.md", "P");
    h.writeHome("home-style.md", "H");
    h.writeProject(
      "_config.json",
      JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "project-style" }] }),
    );
    h.writeHome(
      "_config.json",
      JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "home-style" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("project-style");
  });

  it("home rules still apply for models the project doesn't override (merge, not replace)", () => {
    const h = createLayered();
    h.writeProject("p-style.md", "P");
    h.writeHome("h-style.md", "H");
    h.writeProject(
      "_config.json",
      JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "p-style" }] }),
    );
    h.writeHome(
      "_config.json",
      JSON.stringify({ auto: [{ model: "gpt-5.4", style: "h-style" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("p-style");
    expect(h.resolver.resolveAutoStyleName("gpt-5.4")).toBe("h-style");
  });

  it("auto rule in one scope can reference a style that lives in another scope", () => {
    const h = createLayered();
    // Rule in project, style file in home.
    h.writeProject(
      "_config.json",
      JSON.stringify({ auto: [{ model: "claude-sonnet-4-5", style: "home-only" }] }),
    );
    h.writeHome("home-only.md", "home only text");

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("home-only");
  });

  it("collision between name.md and name/default.md is reported per-root, not suppressed by shadowing", () => {
    const h = createLayered();
    h.writeProject("dup.md", "P file");
    h.writeProject("dup/default.md", "P folder");
    h.writeHome("dup.md", "H file");
    h.writeHome("dup/default.md", "H folder");

    h.resolver.listStyles();
    const ids = h.warnings.map((w) => w.id).sort();
    // Each root's own internal name.md vs name/default.md inconsistency is surfaced
    // independently — shadowing doesn't suppress local file hygiene warnings.
    expect(ids).toEqual(["style:collision:home:dup", "style:collision:project:dup"]);
  });

  it("writableDir returns the project root", () => {
    const h = createLayered();
    expect(h.resolver.writableDir()).toBe(h.projectDir);
  });

  it("writableDir falls back to first root when no project scope is configured", () => {
    const homeDir = tempDir("pi-styles-home-only-");
    const resolver = new StyleResolver([{ dir: homeDir, scope: "home" }]);
    expect(resolver.writableDir()).toBe(homeDir);
  });

  it("missing project dir is ignored — home-only setup still works", () => {
    const projectDir = path.join(tempDir("pi-styles-missing-"), "does-not-exist");
    const homeDir = tempDir("pi-styles-home-fallback-");
    writeUnder(homeDir, "fallback.md", "HOME");
    const resolver = new StyleResolver([
      { dir: projectDir, scope: "project" },
      { dir: homeDir, scope: "home" },
    ]);

    expect(resolver.listStyles().map((s) => s.name)).toEqual(["fallback"]);
    expect(resolver.resolveStyleContent("fallback", "claude-sonnet-4-5")?.rawText).toBe("HOME");
  });

  it("dedupes roots that resolve to the same absolute path", () => {
    const dir = tempDir("pi-styles-dup-root-");
    writeUnder(dir, "only.md", "ONE");
    // Same dir registered under two scopes — second occurrence dropped.
    const resolver = new StyleResolver(
      [
        { dir, scope: "project" },
        { dir, scope: "home" },
      ],
      (_id, _msg) => {
        /* swallow */
      },
    );
    expect(resolver.roots().map((r) => r.scope)).toEqual(["project"]);
    expect(resolver.listStyles().map((s) => s.scope)).toEqual(["project"]);
  });
});
