# Remove Hardcoded userStyle Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the styles extension from automatically wrapping user-authored style instructions in `<userStyle>` tags while preserving ephemeral request-time injection and cache-friendly placement.

**Architecture:** The resolver will continue to read and trim Markdown style files, but its resolved injection field becomes `styleText` and equals the user-authored file content after trimming. Injectors remain transport-only: they splice the provided text into provider payloads without adding, removing, or interpreting markup. Documentation and metadata will describe opaque-free raw style injection rather than Claude.ai-style `<userStyle>` wrapping.

**Tech Stack:** TypeScript, Pi extension API `before_provider_request`, Vitest, npm workspaces.

---

## File Structure

- Modify `extensions/styles/styleResolver.ts`: rename the resolved/cache field from `wrappedText` to `styleText`; make it raw trimmed Markdown text, not generated XML-like tags.
- Modify `extensions/styles/index.ts`: pass `resolved.styleText` to injectors and update extension comments and command description.
- Modify `extensions/styles/styleResolver.test.ts`: assert resolver returns unwrapped raw style text.
- Modify `extensions/styles/index.test.ts`: assert provider payloads receive unwrapped style text.
- Modify `extensions/styles/injectors.test.ts`: use an unwrapped fixture so injector tests document that injectors do not require tags.
- Modify `extensions/styles/injectors.ts`: update comments to describe cache-placement behavior without claiming `<userStyle>` wrapping.
- Modify `extensions/styles/README.md`: update user-facing behavior docs; explicitly say the extension injects the file content as-is after trimming and users may add their own tags/headings if desired.
- Modify `extensions/styles/package.json`: update description and keywords so package metadata no longer advertises hardcoded `<userStyle>` wrapping.

---

### Task 1: Update the resolver contract and tests

**Files:**
- Modify: `extensions/styles/styleResolver.test.ts`
- Modify: `extensions/styles/styleResolver.ts`

- [ ] **Step 1: Change the resolver test to expect unwrapped style text**

In `extensions/styles/styleResolver.test.ts`, replace the current `reads and wraps a simple style` test with:

```ts
  it("reads a simple style without wrapping it", () => {
    const h = createHarness();
    h.write("concise.md", "Be concise.\n");

    expect(h.resolver.resolveStyleContent("concise", "claude-sonnet-4-5")).toMatchObject({
      name: "concise",
      rawText: "Be concise.",
      styleText: "Be concise.",
    });
  });
```

- [ ] **Step 2: Run the focused resolver test and verify it fails before implementation**

Run:

```bash
npm test -w pi-styles -- styleResolver.test.ts
```

Expected before implementation: FAIL because `styleText` is absent and the resolver still returns `wrappedText: "<userStyle>\nBe concise.\n</userStyle>"`.

- [ ] **Step 3: Rename resolver fields and stop wrapping**

In `extensions/styles/styleResolver.ts`, change the resolved/cache interfaces from:

```ts
export interface ResolvedStyleContent {
  name: string;
  file: string;
  rawText: string;
  wrappedText: string;
}

interface TextCacheEntry {
  mtimeMs: number;
  rawText: string;
  wrappedText: string;
}
```

to:

```ts
export interface ResolvedStyleContent {
  name: string;
  file: string;
  rawText: string;
  styleText: string;
}

interface TextCacheEntry {
  mtimeMs: number;
  rawText: string;
  styleText: string;
}
```

Then change `readMarkdown()` from:

```ts
    const cached = this.contentCache.get(absoluteFile);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      if (!cached.wrappedText) return null;
      return { name, file: absoluteFile, rawText: cached.rawText, wrappedText: cached.wrappedText };
    }

    const rawText = fs.readFileSync(absoluteFile, "utf8").trim();
    const wrappedText = rawText ? `<userStyle>\n${rawText}\n</userStyle>` : "";
    this.contentCache.set(absoluteFile, { mtimeMs: st.mtimeMs, rawText, wrappedText });

    if (!wrappedText) return null;
    return { name, file: absoluteFile, rawText, wrappedText };
```

to:

```ts
    const cached = this.contentCache.get(absoluteFile);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      if (!cached.styleText) return null;
      return { name, file: absoluteFile, rawText: cached.rawText, styleText: cached.styleText };
    }

    const rawText = fs.readFileSync(absoluteFile, "utf8").trim();
    const styleText = rawText;
    this.contentCache.set(absoluteFile, { mtimeMs: st.mtimeMs, rawText, styleText });

    if (!styleText) return null;
    return { name, file: absoluteFile, rawText, styleText };
```

- [ ] **Step 4: Run the focused resolver test and verify it passes**

Run:

```bash
npm test -w pi-styles -- styleResolver.test.ts
```

Expected after implementation: PASS.

---

### Task 2: Update request-time injection call sites and integration tests

**Files:**
- Modify: `extensions/styles/index.test.ts`
- Modify: `extensions/styles/index.ts`

- [ ] **Step 1: Change integration test payload expectations to raw style text**

In `extensions/styles/index.test.ts`, replace these expected injected texts:

```ts
"<userStyle>\nDefault thought style\n</userStyle>"
"<userStyle>\nPROJECT\n</userStyle>"
"<userStyle>\nClaude thought style\n</userStyle>"
"<userStyle>\nDefault thought style\n</userStyle>"
"<userStyle>\nBe concise\n</userStyle>"
```

with:

```ts
"Default thought style"
"PROJECT"
"Claude thought style"
"Default thought style"
"Be concise"
```

The OpenAI Responses expectation should become:

```ts
expect(payload.input.at(-1)).toEqual({
  role: "user",
  content: [{ type: "input_text", text: "Be concise" }],
});
```

- [ ] **Step 2: Run the focused index tests and verify they fail before updating the call sites**

Run:

```bash
npm test -w pi-styles -- index.test.ts
```

Expected before updating `index.ts`: FAIL or TypeScript/Vitest failure because `index.ts` still reads `resolved.wrappedText` after Task 1 renamed the field.

- [ ] **Step 3: Pass `styleText` to injectors and update extension copy**

In `extensions/styles/index.ts`, replace the top comment:

```ts
 * styles — claude.ai-style output styles for Pi.
```

with:

```ts
 * styles — ephemeral output styles for Pi.
```

Replace:

```ts
 * The resolved style text is injected EPHEMERALLY into every provider request as
 * a trailing <userStyle> block. It is never persisted to the session and never
 * accumulates in conversation history.
```

with:

```ts
 * The resolved style text is injected EPHEMERALLY into every provider request as
 * trailing user-role content. It is never persisted to the session and never
 * accumulates in conversation history.
```

Replace both call sites:

```ts
        inject(event.payload, resolved.wrappedText);
```

and:

```ts
      const ok = genericFallback(event.payload, resolved.wrappedText);
```

with:

```ts
        inject(event.payload, resolved.styleText);
```

and:

```ts
      const ok = genericFallback(event.payload, resolved.styleText);
```

Replace the command description:

```ts
    description: "Select, create, auto-route, or turn off an output style (ephemeral <userStyle> injection)",
```

with:

```ts
    description: "Select, create, auto-route, or turn off an output style (ephemeral raw style injection)",
```

- [ ] **Step 4: Run the focused index tests and verify they pass**

Run:

```bash
npm test -w pi-styles -- index.test.ts
```

Expected after implementation: PASS.

---

### Task 3: Update injector fixtures and comments

**Files:**
- Modify: `extensions/styles/injectors.test.ts`
- Modify: `extensions/styles/injectors.ts`

- [ ] **Step 1: Change the injector test fixture to raw style text**

In `extensions/styles/injectors.test.ts`, replace:

```ts
const STYLE = "<userStyle>\nBe concise.\n</userStyle>";
```

with:

```ts
const STYLE = "Be concise.";
```

No other expectation changes should be needed, because injector tests compare against the `STYLE` constant.

- [ ] **Step 2: Run injector tests and verify they pass**

Run:

```bash
npm test -w pi-styles -- injectors.test.ts
```

Expected: PASS. These tests should not depend on tag semantics.

- [ ] **Step 3: Update injector comments to describe raw text splicing**

In `extensions/styles/injectors.ts`, replace:

```ts
 * This mirrors how claude.ai injects <userStyle> and how Claude Code injects
 * <system-reminder>: a trailing, ephemeral, user-role content splice — never the
 * system prompt (which is the most cache-hostile place to put volatile text).
```

with:

```ts
 * This uses the same cache-friendly placement pattern as other ephemeral
 * instruction splices: trailing user-role content, never the system prompt
 * (which is the most cache-hostile place to put volatile text). The style text
 * is inserted exactly as supplied by the style resolver.
```

- [ ] **Step 4: Run injector tests again after comment-only changes**

Run:

```bash
npm test -w pi-styles -- injectors.test.ts
```

Expected: PASS.

---

### Task 4: Update public docs and package metadata

**Files:**
- Modify: `extensions/styles/README.md`
- Modify: `extensions/styles/package.json`

- [ ] **Step 1: Update README opening behavior description**

In `extensions/styles/README.md`, replace:

```md
claude.ai-style **output styles** for Pi. An active style is injected
*ephemerally* into every model request as a trailing `<userStyle>…</userStyle>`
block — it never persists to the session, never accumulates, and is added at
the provider payload layer immediately before the request is sent.
```

with:

```md
**Output styles** for Pi. An active style is injected *ephemerally* into every
model request as trailing user-role content — it never persists to the session,
never accumulates, and is added at the provider payload layer immediately before
the request is sent.

The extension injects the trimmed contents of your style file exactly as written.
If you want XML-like tags, Markdown headings, bullets, or plain prose, put that
structure in the style file yourself.
```

- [ ] **Step 2: Update README injection section**

In `extensions/styles/README.md`, after this paragraph:

```md
Injection happens in `before_provider_request` — after Pi serializes the payload
and assigns provider-specific cache metadata. The resolved style text is spliced
in after cache breakpoints where the provider format exposes them, so style
changes do not invalidate cached conversation prefixes.
```

ensure the next paragraph reads:

```md
The style text is the style file's trimmed Markdown content. The extension does
not wrap it in tags or otherwise transform its structure.
```

If there is no paragraph between that cache paragraph and `Dispatch is keyed on`, insert the new paragraph there.

- [ ] **Step 3: Update package metadata**

In `extensions/styles/package.json`, replace:

```json
"description": "claude.ai-style ephemeral output styles for Pi, injected as a trailing <userStyle> block after cache_control so prompt caching is preserved.",
"keywords": ["pi-package", "pi-extension", "styles", "userStyle", "prompt"],
```

with:

```json
"description": "Ephemeral output styles for Pi, injected as trailing raw style text after cache_control so prompt caching is preserved.",
"keywords": ["pi-package", "pi-extension", "styles", "prompt"],
```

- [ ] **Step 4: Verify docs and metadata no longer claim hardcoded userStyle wrapping**

Run:

```bash
rg -n "claude\.ai-style|<userStyle|</userStyle|userStyle|wrappedText|wraps|wrapped" extensions/styles
```

Expected after all tasks: no matches in `extensions/styles`. If `rg` exits with status 1 because there are no matches, that is the desired result.

---

### Task 5: Full verification and commit

**Files:**
- Verify: `extensions/styles/*`

- [ ] **Step 1: Run all styles extension tests**

Run:

```bash
npm test -w pi-styles
```

Expected: all tests pass.

- [ ] **Step 2: Run the styles extension typecheck**

Run:

```bash
npm run typecheck -w pi-styles
```

Expected: TypeScript completes with no errors.

- [ ] **Step 3: Run final search for stale naming and docs**

Run:

```bash
rg -n "claude\.ai-style|<userStyle|</userStyle|userStyle|wrappedText|wraps|wrapped" extensions/styles
```

Expected: no matches; `rg` may exit with status 1 because no matches were found.

- [ ] **Step 4: Review the diff**

Run:

```bash
git diff -- extensions/styles
```

Expected: the diff only removes automatic tag wrapping, renames `wrappedText` to `styleText`, updates tests to raw style text, and updates comments/docs/metadata.

- [ ] **Step 5: Commit the change**

Run:

```bash
git add extensions/styles/index.ts extensions/styles/injectors.ts extensions/styles/styleResolver.ts extensions/styles/index.test.ts extensions/styles/injectors.test.ts extensions/styles/styleResolver.test.ts extensions/styles/README.md extensions/styles/package.json docs/superpowers/plans/2026-06-07-remove-userstyle-wrapping.md
git commit -m "fix(styles): inject style text without wrapping"
```

Expected: commit succeeds with the implementation and plan document.
