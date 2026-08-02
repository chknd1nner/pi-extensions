# Pi `grep` Activation Package Specification

**Status:** Revised design proposal
**Proposed package:** `pi-grep`
**Initial scope:** Activate Pi's shipped `grep` tool in ordinary coding sessions

## 1. Summary

Pi ships built-in definitions for `grep`, `find`, and `ls`, but its default active tool set contains only `read`, `bash`, `edit`, and `write`. The additional read-only tools are available for explicit tool selections and restricted worker configurations, but an ordinary model session cannot call them.

`pi-grep` should opt an ordinary session into Pi's existing built-in tool named `grep`.

The package should not initially register a replacement tool or reimplement ripgrep execution. It should add `grep` to Pi's active tool set while preserving every tool that is already active. This exposes the exact affordance models already tend to reach for and routes repository content searches through a structured, read-only tool instead of Bash.

The first release is deliberately an activation experiment. Stronger prompt guidance or a richer grep implementation should be added only if dogfooding demonstrates that activation alone is insufficient.

## 2. Context

Pi has two relevant tool concepts:

1. **Registered tools:** all tool definitions known to the session. Current Pi builds register `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.
2. **Active tools:** the subset whose schemas and prompt metadata are exposed to the model. The ordinary default is `read`, `bash`, `edit`, and `write`.

Therefore Pi's built-in `grep` is present but inactive by default. It can already be selected explicitly with Pi's tool-selection options or given to a delegate worker independently of the parent's active tools.

When `grep` is inactive, Pi's default system prompt permits repository searches through Bash. When `grep` is active, its tool schema and prompt snippet become visible to the model and Pi no longer needs to direct the model toward Bash-based `rg` for ordinary file exploration.

This package turns that opt-in into a reusable installation choice.

## 3. Design principle

Lean into model training rather than fight it:

- expose a tool literally named `grep`;
- let a model's learned impulse to "grep" map directly to a structured tool call;
- keep Bash available for pipelines, stdin, command output, logs, and searches embedded in larger shell operations;
- avoid adding a second synonym such as `search`, `code_search`, or `ripgrep`;
- keep conventional grep behavior: matching content with paths and line numbers is the default result.

## 4. Goals

1. Make Pi's shipped `grep` tool active in ordinary sessions when `pi-grep` is installed.
2. Preserve the rest of the session's active tool set and its ordering.
3. Reuse Pi's existing grep schema, execution, cancellation, truncation, error behavior, and rendering.
4. Remain idempotent across startup, reload, resume, new-session, and fork lifecycles.
5. Respect Pi tool allowlists and exclusions.
6. Determine through dogfooding whether merely exposing `grep` is enough to redirect repository searches away from Bash.

## 5. Non-goals for the initial release

- Replacing or forking Pi's built-in grep implementation.
- Reimplementing ripgrep discovery, spawning, cancellation, parsing, truncation, or rendering.
- Reproducing Claude Code's complete Grep schema.
- Adding filename, count, or multiline output modes.
- Providing GNU grep or complete ripgrep flag compatibility.
- Prohibiting grep or ripgrep inside all Bash commands.
- Activating `find` or `ls`; those remain separate choices.
- Changing the tool set of delegate workers unless their own allowlist requests `grep`.

## 6. Package shape

Create a single-extension package:

```text
packages/pi-grep/
  package.json
  README.md
  index.ts
  tests/
    index.test.ts
```

The package manifest should:

- expose `./index.ts` through `pi.extensions`;
- include `keywords: ["pi-package"]`;
- declare Pi-provided packages as peer dependencies with `"*"` versions;
- avoid runtime dependencies.

The package does not register a tool of its own in the initial release, so loading it should not produce a built-in-tool override warning.

## 7. Runtime behavior

Register a `session_start` handler. On every session start:

1. Read the currently available tools with `pi.getAllTools()`.
2. If `grep` is not available, do nothing. This respects explicit `--tools`, `--exclude-tools grep`, and `--no-tools` selections, which may remove it from the session registry.
3. Read the active names with `pi.getActiveTools()`.
4. If `grep` is already active, do nothing.
5. Otherwise append `grep` and call `pi.setActiveTools()`.

Conceptually:

```ts
export default function piGrep(pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const available = pi.getAllTools().some((tool) => tool.name === "grep");
    if (!available) return;

    const active = pi.getActiveTools();
    if (active.includes("grep")) return;

    pi.setActiveTools([...active, "grep"]);
  });
}
```

The implementation should use the real extension types and follow the current Pi extension API documentation. The sketch above specifies behavior, not necessarily final formatting.

### Tool-selection precedence

Pi's explicit name allowlist and exclusion filtering remain authoritative:

- `--exclude-tools grep` prevents activation because `grep` is absent from the available registry.
- `--tools ...` activates `grep` only when that allowlist contains `grep`.
- `--no-tools` leaves no available tool to activate.
- An already active `grep` remains unchanged.

`--no-builtin-tools` requires a documented integration test. If Pi keeps inactive built-in definitions available to extensions under that option, installing `pi-grep` is itself an explicit opt-in to reactivating `grep`; users can still suppress it with `--exclude-tools grep` or `--no-tools`.

## 8. Reused built-in behavior

The initial package deliberately inherits the installed Pi version's grep contract. In the current target version, that includes:

```text
pattern       string, required
path          string, optional; file or directory
glob          string, optional
ignoreCase    boolean, optional
literal       boolean, optional
context       number, optional; symmetric before/after context
limit         number, optional; default 100 matches
```

Current behavior also includes:

- ripgrep regex semantics and fixed-string mode;
- matching lines with relative paths and line numbers;
- hidden, non-ignored file searching while respecting `.gitignore`;
- argument-array execution with `--` before the pattern and path;
- safe handling of patterns beginning with `-`;
- leading-`@` path normalization and cwd-relative resolution;
- explicit missing-path errors;
- cancellation that terminates ripgrep;
- successful `No matches found` results;
- 500-character individual-line truncation;
- a 100-match default logical limit and 50 KB output limit;
- compact, expandable TUI rendering with visible truncation warnings;
- Pi's existing ripgrep resolution and actionable unavailable-tool error.

The package README should say that exact schema and behavior may evolve with Pi because `pi-grep` intentionally delegates them to the installed Pi version.

## 9. Prompt behavior

The initial release should not modify the system prompt independently and should not register replacement prompt metadata.

Activating the built-in tool already causes Pi to expose:

```text
grep: Search file contents for patterns (respects .gitignore)
```

The experiment is whether the exact tool name plus its shipped description is sufficient for models to select it naturally.

Bash remains appropriate when:

- a search consumes stdin or process output;
- grep is one stage of a larger pipeline;
- the target is logs or runtime output rather than repository files;
- another shell operation materially surrounds the search.

## 10. Testing requirements

### Unit tests

Use a fake `ExtensionAPI` tool registry and cover:

- appending `grep` to the ordinary active set;
- preserving every existing active tool and its order;
- not duplicating an already active `grep`;
- doing nothing when `grep` is unavailable;
- not activating `find` or `ls`;
- registering no custom tool definitions;
- repeating `session_start` without changing the result after the first activation.

### Pi integration tests

Where practical, cover:

- an ordinary session exposes `read`, `bash`, `edit`, `write`, and `grep` after the package loads;
- `grep` retains Pi's built-in `sourceInfo` rather than becoming an extension override;
- `--exclude-tools grep` prevents activation;
- an explicit `--tools` list without `grep` prevents activation;
- an explicit `--tools` list containing `grep` works normally;
- `--no-tools` remains tool-free;
- the observed and documented behavior of `--no-builtin-tools`;
- reload, resume, new-session, and fork lifecycles remain idempotent;
- no built-in override warning appears.

The package should not duplicate Pi's own grep execution test suite.

## 11. Dogfood evaluation

After activation, exercise representative models with repository-search prompts such as:

- "Find where authentication failures are handled."
- "Search for uses of this configuration key."
- "Show me the tests mentioning cancellation."
- "Count or summarize the places that construct this type."

Record whether the model chooses:

- the dedicated `grep` tool;
- Bash with `rg` or `grep`;
- a reasonable alternative such as `read` when the target file is already known.

Evaluate tool choice separately from result quality. Do not expand the implementation merely because the built-in result format differs from another coding agent.

## 12. Escalation path

Enhancements must follow observed problems rather than being included preemptively.

### Stage 1: Activation only

Ship the design in this specification.

Success means models generally use the active `grep` tool for ordinary repository content searches.

### Stage 2: Prompt-policy override

If models still prefer Bash for ordinary repository searches, add the smallest prompt intervention that works:

```text
Use grep for repository content searches instead of running grep or rg through Bash.
```

Keep the instruction scoped so Bash remains valid for pipelines, stdin, logs, and runtime output.

Prefer a supported Pi prompt-guideline mechanism. If adding metadata requires registering a same-name wrapper, reuse `createGrepToolDefinition()` and preserve the exact built-in input and result contracts rather than copying the implementation.

### Stage 3: Functional extension

Only if dogfooding reveals concrete capability or context-efficiency problems should `pi-grep` replace the built-in executor.

Candidate improvements, in likely priority order:

1. logical `offset` pagination rather than repeatedly increasing a head limit;
2. optional `files_with_matches` output for broad discovery;
3. file-type filtering;
4. asymmetric context (`-A` and `-B`);
5. multiline search;
6. count mode.

If added, `content` should remain the default because it matches conventional grep behavior and the model prior this package is intended to exploit.

A functional override must separately resolve:

- compatibility with Pi's documented built-in `GrepToolDetails` result shape;
- access to Pi's ripgrep resolver without importing private package paths;
- deterministic, entry-aware pagination under hard memory, byte, and line bounds;
- precise count semantics for multiple matches per line, multiline patterns, and inverted searches;
- path relativity suitable for follow-up `read` calls;
- real ripgrep integration tests in addition to fake-runner tests.

## 13. Acceptance criteria

The initial design is complete when:

- installing `pi-grep` makes Pi's shipped `grep` active in an ordinary session;
- the package preserves all previously active tools;
- activation is idempotent;
- explicit allowlists and exclusions remain authoritative;
- the active tool uses Pi's built-in definition, execution, result details, and renderer;
- no duplicate tool or built-in override warning is produced;
- the package contains no ripgrep process implementation;
- unit tests and the relevant Pi integration tests pass;
- the README clearly describes the staged experiment and how to suppress `grep` explicitly.

## 14. Reference material

- [Pi quickstart: default and additional built-in tools](pi/docs/quickstart.md)
- [Pi extension API: active tool management](pi/docs/extensions.md#pigetactivetools--pigetalltools--pisetactivetoolsnames)
- [Pi extension API: custom tools and built-in overrides](pi/docs/extensions.md#custom-tools)
- [Pi built-in grep implementation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/grep.ts)
- [Original read-only exploration tools proposal](https://github.com/badlogic/pi-mono/issues/74)
