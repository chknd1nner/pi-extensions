import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StyleResolver,
  isSafeVariantBasename,
  isStyleBasename,
} from "./styleResolver";

type Warning = { id: string; message: string };

type Harness = {
  dir: string;
  resolver: StyleResolver;
  warnings: Warning[];
  write(rel: string, text: string): void;
};

const tempDirs: string[] = [];

function createHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-styles-resolver-"));
  tempDirs.push(dir);
  const warnings: Warning[] = [];
  const resolver = new StyleResolver(dir, (id, message) => warnings.push({ id, message }));
  return {
    dir,
    resolver,
    warnings,
    write(rel: string, text: string) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isSafeVariantBasename", () => {
  it("accepts exact safe model IDs", () => {
    expect(isSafeVariantBasename("claude-sonnet-4-5")).toBe(true);
    expect(isSafeVariantBasename("gpt-5.4")).toBe(true);
    expect(isSafeVariantBasename("model_1.A")).toBe(true);
  });

  it("rejects partial matches and unsafe path-like model IDs", () => {
    expect(isSafeVariantBasename("a/b")).toBe(false);
    expect(isSafeVariantBasename("a\\b")).toBe(false);
    expect(isSafeVariantBasename("model:tag")).toBe(false);
    expect(isSafeVariantBasename(" model")).toBe(false);
    expect(isSafeVariantBasename(".hidden")).toBe(false);
    expect(isSafeVariantBasename(".")).toBe(false);
    expect(isSafeVariantBasename("..")).toBe(false);
    expect(isSafeVariantBasename("")).toBe(false);
  });
});

describe("isStyleBasename", () => {
  it("accepts top-level style names", () => {
    expect(isStyleBasename("concise")).toBe(true);
    expect(isStyleBasename("thought-catalyst")).toBe(true);
    expect(isStyleBasename("Style Name")).toBe(true);
  });

  it("rejects paths, extension suffixes, control names, and dot segments", () => {
    expect(isStyleBasename("../concise")).toBe(false);
    expect(isStyleBasename("foo/bar")).toBe(false);
    expect(isStyleBasename("foo\\bar")).toBe(false);
    expect(isStyleBasename("concise.md")).toBe(false);
    expect(isStyleBasename("_config")).toBe(false);
    expect(isStyleBasename(".")).toBe(false);
    expect(isStyleBasename("..")).toBe(false);
    expect(isStyleBasename("")).toBe(false);
  });
});

describe("StyleResolver.listStyles", () => {
  it("lists simple styles and variant folders with default.md", () => {
    const h = createHarness();
    h.write("concise.md", "Be concise");
    h.write("thought-catalyst/default.md", "Think deeply");
    h.write("broken/claude-sonnet-4-5.md", "Ignored without default");
    h.write("_config.json", "{\"auto\":[]}");

    expect(h.resolver.listStyles()).toEqual([
      { name: "concise", source: "file", scope: "project", reserved: false, label: "concise" },
      {
        name: "thought-catalyst",
        source: "folder",
        scope: "project",
        reserved: false,
        label: "thought-catalyst",
      },
    ]);
  });

  it("deduplicates simple/folder collisions and warns once", () => {
    const h = createHarness();
    h.write("foo.md", "Simple wins");
    h.write("foo/default.md", "Folder loses");

    expect(h.resolver.listStyles()).toEqual([
      { name: "foo", source: "file", scope: "project", reserved: false, label: "foo" },
    ]);
    expect(h.warnings.map((w) => w.id)).toEqual(["style:collision:project:foo"]);

    h.resolver.listStyles();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:collision:project:foo"]);
  });

  it("labels reserved style filenames without making them direct command targets", () => {
    const h = createHarness();
    h.write("auto.md", "Reserved file");

    expect(h.resolver.listStyles()).toEqual([
      {
        name: "auto",
        source: "file",
        scope: "project",
        reserved: true,
        label: "auto (style; direct /style auto is a command)",
      },
    ]);
    expect(h.warnings.map((w) => w.id)).toEqual(["style:reserved:project:auto"]);
  });
});

describe("StyleResolver.resolveAutoStyleName", () => {
  it("matches exact model strings and model arrays in order", () => {
    const h = createHarness();
    h.write("slow.md", "Slow");
    h.write("fast.md", "Fast");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "slow" },
          { model: ["gpt-5.4", "gpt-5.4-mini"], style: "fast" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("slow");
    expect(h.resolver.resolveAutoStyleName("gpt-5.4-mini")).toBe("fast");
    expect(h.resolver.resolveAutoStyleName("claude-sonnet")).toBeNull();
  });

  it("treats an empty model array as a valid never-matching rule without warning", () => {
    const h = createHarness();
    h.write("never.md", "Never");
    h.write(
      "_config.json",
      JSON.stringify({ auto: [{ model: [], style: "never" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings).toEqual([]);
  });

  it("uses the first resolvable rule when multiple rules match", () => {
    const h = createHarness();
    h.write("first.md", "First");
    h.write("second.md", "Second");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "first" },
          { model: "claude-sonnet-4-5", style: "second" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("first");
  });

  it("skips missing matched styles and continues to the next resolvable rule", () => {
    const h = createHarness();
    h.write("fallback.md", "Fallback");
    h.write(
      "_config.json",
      JSON.stringify({
        auto: [
          { model: "claude-sonnet-4-5", style: "missing" },
          { model: "claude-sonnet-4-5", style: "fallback" },
        ],
      }),
    );

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBe("fallback");
    expect(h.warnings.map((w) => w.id)).toContain("config:missing-style:project:0:missing");
  });

  it("warns for invalid config rules without throwing", () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ auto: [{ model: 42, style: "x" }, { model: "m", style: "../x" }] }));

    expect(h.resolver.resolveAutoStyleName("m")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual([
      "config:rule:project:0:model",
      "config:rule:project:1:style",
    ]);
  });

  it("warns once for invalid _config.json syntax", () => {
    const h = createHarness();
    h.write("_config.json", "{ not json");

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["config:parse:project"]);
  });

  it("warns when _config.json exists without an auto array", () => {
    const h = createHarness();
    h.write("_config.json", JSON.stringify({ styles: [] }));

    expect(h.resolver.resolveAutoStyleName("claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["config:auto:project"]);
  });

  it("matches config model IDs that are unsafe as variant filenames", () => {
    const h = createHarness();
    h.write("router/default.md", "Default route");
    h.write(
      "_config.json",
      JSON.stringify({ auto: [{ model: "openrouter/claude", style: "router" }] }),
    );

    expect(h.resolver.resolveAutoStyleName("openrouter/claude")).toBe("router");
  });
});

describe("StyleResolver.resolveStyleContent", () => {
  it("reads and wraps a simple style", () => {
    const h = createHarness();
    h.write("concise.md", "Be concise.\n");

    expect(h.resolver.resolveStyleContent("concise", "claude-sonnet-4-5")).toMatchObject({
      name: "concise",
      rawText: "Be concise.",
      wrappedText: "<userStyle>\nBe concise.\n</userStyle>",
    });
  });

  it("uses an exact safe model-ID variant before default.md", () => {
    const h = createHarness();
    h.write("thought/default.md", "Default");
    h.write("thought/claude-sonnet-4-5.md", "Claude variant");

    expect(h.resolver.resolveStyleContent("thought", "claude-sonnet-4-5")?.rawText).toBe(
      "Claude variant",
    );
    expect(h.resolver.resolveStyleContent("thought", "gpt-5.4")?.rawText).toBe("Default");
  });

  it("falls back to default.md for unsafe model IDs while config matching remains independent", () => {
    const h = createHarness();
    h.write("router/default.md", "Default");
    h.write("router/openrouter.md", "Not selected by slash ID");

    expect(h.resolver.resolveStyleContent("router", "openrouter/claude")?.rawText).toBe("Default");
  });

  it("does not serve cached content across different variant files for the same style name", () => {
    const h = createHarness();
    h.write("thought/default.md", "Default");
    h.write("thought/model-a.md", "Variant A");
    h.write("thought/model-b.md", "Variant B");

    const a = h.resolver.resolveStyleContent("thought", "model-a");
    const b = h.resolver.resolveStyleContent("thought", "model-b");
    const d = h.resolver.resolveStyleContent("thought", "unknown-model");

    expect(a?.rawText).toBe("Variant A");
    expect(b?.rawText).toBe("Variant B");
    expect(d?.rawText).toBe("Default");
    expect(a?.file).not.toBe(b?.file);
    expect(b?.file).not.toBe(d?.file);
  });

  it("warns and no-ops for a variant folder without default.md", () => {
    const h = createHarness();
    h.write("broken/claude-sonnet-4-5.md", "Ignored");

    expect(h.resolver.resolveStyleContent("broken", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:variant-missing-default:project:broken"]);
  });

  it("warns and no-ops for invalid style names", () => {
    const h = createHarness();

    expect(h.resolver.resolveStyleContent("../missing", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:invalid"]);
  });

  it("warns and no-ops for missing manual styles", () => {
    const h = createHarness();

    expect(h.resolver.resolveStyleContent("missing", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings.map((w) => w.id)).toEqual(["style:missing:missing"]);
  });

  it("returns null without a warning for empty style files", () => {
    const h = createHarness();
    h.write("empty.md", "\n\n");

    expect(h.resolver.resolveStyleContent("empty", "claude-sonnet-4-5")).toBeNull();
    expect(h.warnings).toEqual([]);
  });
});
