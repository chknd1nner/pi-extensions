import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const ORIGINAL_ENV = { ...process.env };

function makeHome() {
  const dir = join(tmpdir(), `brightdata-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(dir, ".pi"), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

async function loadFresh() {
  vi.resetModules();
  return await import("../config.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadBrightDataConfig", () => {
  it("uses defaults when ~/.pi/brightdata.json is missing", async () => {
    const home = makeHome();
    process.env.HOME = home;
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("pi_serp_api");
    expect(config.brightdata.unlockerZone).toBe("mcp_unlocker");
    expect(config.brightdata.defaultCountry).toBe("au");
    expect(config.search.maxResults).toBe(20);
    expect(config.fetch.maxInlineChars).toBe(30000);
    expect(config.fetch.outputDir).toBe(".pi/brightdata/pages");
    expect(config.pdf.outputDir).toBe(".pi/brightdata/pdfs");
  });

  it("loads camelCase JSON values", async () => {
    const home = makeHome();
    process.env.HOME = home;
    writeFileSync(join(home, ".pi", "brightdata.json"), JSON.stringify({
      brightdata: { serpZone: "serp_custom", unlockerZone: "unlock_custom", defaultCountry: "us", defaultLanguage: "fr", concurrency: 2 },
      search: { defaultEngine: "bing", defaultLimit: 7, maxQueries: 4, maxResults: 9 },
      fetch: { maxUrls: 3, maxInlineChars: 12000, preferMarkdown: false, outputDir: "tmp/pages" },
      pdf: { inlineMaxPages: 2, inlineMaxChars: 5000, outputDir: "tmp/pdfs" }
    }));
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("serp_custom");
    expect(config.brightdata.unlockerZone).toBe("unlock_custom");
    expect(config.brightdata.defaultLanguage).toBe("fr");
    expect(config.brightdata.concurrency).toBe(2);
    expect(config.search.defaultEngine).toBe("bing");
    expect(config.search.defaultLimit).toBe(7);
    expect(config.fetch.preferMarkdown).toBe(false);
    expect(config.fetch.outputDir).toBe("tmp/pages");
    expect(config.pdf.inlineMaxPages).toBe(2);
    expect(config.pdf.outputDir).toBe("tmp/pdfs");
  });

  it("lets zone environment variables override JSON", async () => {
    const home = makeHome();
    process.env.HOME = home;
    process.env.BRIGHTDATA_SERP_ZONE = "env_serp";
    process.env.BRIGHTDATA_UNLOCKER_ZONE = "env_unlocker";
    writeFileSync(join(home, ".pi", "brightdata.json"), JSON.stringify({
      brightdata: { serpZone: "json_serp", unlockerZone: "json_unlocker" }
    }));
    const { loadBrightDataConfig } = await loadFresh();

    const config = loadBrightDataConfig();

    expect(config.brightdata.serpZone).toBe("env_serp");
    expect(config.brightdata.unlockerZone).toBe("env_unlocker");
  });

  it("prefers BRIGHT_DATA_KEY over BRIGHTDATA_API_KEY", async () => {
    process.env.BRIGHT_DATA_KEY = "primary";
    process.env.BRIGHTDATA_API_KEY = "fallback";
    const { getBrightDataApiKey } = await loadFresh();

    expect(getBrightDataApiKey()).toBe("primary");
  });

  it("uses BRIGHTDATA_API_KEY when BRIGHT_DATA_KEY is absent", async () => {
    delete process.env.BRIGHT_DATA_KEY;
    process.env.BRIGHTDATA_API_KEY = "fallback";
    const { getBrightDataApiKey } = await loadFresh();

    expect(getBrightDataApiKey()).toBe("fallback");
  });

  it("throws a parse error with the config path for malformed JSON", async () => {
    const home = makeHome();
    process.env.HOME = home;
    writeFileSync(join(home, ".pi", "brightdata.json"), "{bad json");
    const { loadBrightDataConfig } = await loadFresh();

    expect(() => loadBrightDataConfig()).toThrow(/Failed to parse .*brightdata\.json/);
  });
});
