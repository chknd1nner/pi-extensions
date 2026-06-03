# NVIDIA NIM reasoning response shapes for Pi

> Date tested: 2026-06-02  
> Endpoint: `https://integrate.api.nvidia.com/v1/chat/completions`  
> Provider config under test: `/Users/martinkuek/.pi/agent/models.json`, provider `nvidia-nim`  
> Method: streaming Chat Completions probe using `stream: true`, `max_tokens: 512`, `temperature: 0.2`.

## Probe prompt

```text
Solve this logic puzzle: In the Monty Hall problem, you choose one of three doors. The host, who knows where the car is, opens a different door showing a goat. Should you switch doors? Please reason as needed, then give the final answer in one sentence.
```

## What Pi currently renders as thinking

For `api: "openai-completions"`, Pi creates an internal `thinking` content block only when a streamed chunk has non-empty text in one of these delta fields:

1. `choices[0].delta.reasoning_content`
2. `choices[0].delta.reasoning`
3. `choices[0].delta.reasoning_text`

This is implemented in:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`
  - `reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"]`
  - those fields emit `thinking_start` / `thinking_delta` / `thinking_end` events.
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js`
  - `content.type === "thinking"` is rendered using the `thinkingText` color and italic style.

So the renderer problem is not arbitrary: NIM must either emit one of those fields, or Pi must transform another response shape into those internal thinking events.

The current `nvidia-nim` `models.json` provider-level `compat` has `supportsReasoningEffort: false` and no model-specific `thinkingFormat`, so Pi's current request shape is effectively the `baseline` probe: it sets `stream: true`, messages, and max-token options, but does not send model-specific thinking controls.

## Main streaming evidence

Structural evidence only. Character counts record field presence; they are not full reasoning traces.

| Model | Variant / request extra | HTTP | Delta keys observed | `reasoning_content` chars | `reasoning` chars | `content` chars | Finish | Pi-renderable thinking? | Notes |
|---|---|---:|---|---:|---:|---:|---|---|---|
| `deepseek-ai/deepseek-v4-flash` | baseline `{}` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 0 | 0 | 171 | stop | No | Field exists but stayed null/empty. |
| `deepseek-ai/deepseek-v4-flash` | `chat_template_kwargs: { thinking: true, reasoning_effort: "high" }` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 231 | 0 | 102 | stop | Yes | NIM/vLLM-recommended DeepSeek V4 shape. |
| `deepseek-ai/deepseek-v4-flash` | top-level `thinking: { type: "enabled" }, reasoning_effort: "high"` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 192 | 0 | 123 | stop | Yes | Shape Pi can currently express with `thinkingFormat: "deepseek"` plus reasoning effort support. |
| `deepseek-ai/deepseek-v4-pro` | baseline `{}` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 0 | 0 | 190 | stop | No | Field exists but stayed null/empty. |
| `deepseek-ai/deepseek-v4-pro` | `chat_template_kwargs: { thinking: true, reasoning_effort: "high" }` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 537 | 0 | 556 | stop | Yes | NIM/vLLM-recommended DeepSeek V4 shape. |
| `deepseek-ai/deepseek-v4-pro` | top-level `thinking: { type: "enabled" }, reasoning_effort: "high"` | 200 | `role`, `content`, `reasoning_content`, `tool_calls` | 821 | 0 | 124 | stop | Yes | Also accepted by hosted NIM. |
| `google/gemma-4-31b-it` | baseline `{}` | 200 | `reasoning_content`, `role`, `content` | 0 | 0 | 454 | stop | No | Field exists but stayed null/empty. |
| `google/gemma-4-31b-it` | `chat_template_kwargs: { enable_thinking: true, preserve_thinking: true }` | 200 | `reasoning_content`, `role`, `content` | 1138 | 0 | 313 | stop | Yes | Existing Pi `qwen-chat-template` request shape matches this. |
| `moonshotai/kimi-k2.6` | baseline `{}` | 200 | `role`, `content`, `reasoning` | 0 | 0 | 1343 | stop | No | `reasoning` key appeared, but stayed empty. |
| `moonshotai/kimi-k2.6` | `chat_template_kwargs: { thinking: true }` | 200 | `role`, `content`, `reasoning`, `reasoning_content` | 2164 | 2164 | 0 | stop | Yes | Emits both recognized fields, but Pi cannot currently express this request shape via static `models.json`. |
| `z-ai/glm-5.1` | baseline `{}` | 200 | `role`, `content` | 0 | 0 | 144 | stop | No | No reasoning-like delta fields. |
| `z-ai/glm-5.1` | top-level `enable_thinking: true` | 200 | `role`, `content` | 0 | 0 | 279 | stop | No | This is Pi's current `thinkingFormat: "zai"` behavior; not useful for hosted NIM GLM. |
| `z-ai/glm-5.1` | `chat_template_kwargs: { enable_thinking: true }` | 200 | `role`, `content`, `reasoning`, `reasoning_content` | 1896 | 1896 | 0 | stop | Yes | Existing Pi `qwen-chat-template` request shape is closer than `zai`. |
| `openai/gpt-oss-120b` | baseline `{}` | 200 | `role`, `content`, `reasoning_content`, `reasoning` | 154 | 154 | 133 | stop | Yes | Matches observed Pi behavior: thinking renders already. |
| `openai/gpt-oss-120b` | top-level `reasoning_effort: "low"` | 200 | `role`, `content`, `reasoning_content`, `reasoning` | 109 | 109 | 218 | stop | Yes | Explicit effort also emits recognized fields. |
| `qwen/qwen3-coder-480b-a35b-instruct` | baseline `{}` | 200 | `content`, `role` | 0 | 0 | 950 | stop | No | Metadata says non-thinking only. |
| `qwen/qwen3-next-80b-a3b-instruct` | baseline `{}` | 200 | `role`, `content` | 0 | 0 | 252 | stop | No | Metadata says instruct/non-thinking only. |
| `qwen/qwen3.5-122b-a10b` | baseline `{}` | 200 | `content`, `role` | 0 | 0 | 106 | stop | No | No reasoning fields without explicit thinking control. |
| `qwen/qwen3.5-122b-a10b` | `chat_template_kwargs: { enable_thinking: true, preserve_thinking: true }` | 200 | `role`, `reasoning_content` | 1891 | 0 | 0 | length | Yes | Reasoning emitted, but 512-token cap ended before final answer content. |
| `qwen/qwen3.5-122b-a10b` | top-level `enable_thinking: true` | 400 | none | 0 | 0 | 0 | n/a | No | Hosted NIM rejects this: `Unsupported parameter(s): enable_thinking`. |
| `qwen/qwen3.5-397b-a17b` | baseline `{}` | 200 | none | 0 | 0 | 0 | none | No | Anomalous HTTP 200 with zero SSE chunks in this run. |
| `qwen/qwen3.5-397b-a17b` | `chat_template_kwargs: { enable_thinking: true, preserve_thinking: true }` | 200 | `role`, `reasoning_content` | 1895 | 0 | 0 | length | Yes | Same as 122B: renderable reasoning but no final answer at 512 tokens. |
| `qwen/qwen3.5-397b-a17b` | top-level `enable_thinking: true` | 400 | none | 0 | 0 | 0 | n/a | No | Hosted NIM rejects this: `Unsupported parameter(s): enable_thinking`. |

Additional targeted GLM probe, based on Z.AI direct API docs:

| Model | Variant / request extra | HTTP | Delta keys observed | `reasoning_content` chars | `reasoning` chars | `content` chars | Pi-renderable thinking? | Notes |
|---|---|---:|---|---:|---:|---:|---|---|
| `z-ai/glm-5.1` | top-level `thinking: { type: "enabled" }` | 200 | `role`, `content` | 0 | 0 | 247 | No | Hosted NIM accepted the parameter but did not emit separated reasoning fields. |

Across the main matrix, `content_contains_think_tags` was false for every result. In this probe, the issue is not inline `<think>...</think>` parsing; it is whether the request causes NIM to emit separated reasoning fields.

## Comparison to Pi expectations

### Already Pi-renderable if emitted

NIM's useful separated reasoning shapes are already in Pi's recognized field set:

- `delta.reasoning_content`
- `delta.reasoning`

No tested model emitted a new separated field name outside Pi's current parser. Therefore, the renderer/parser does not need a new field name for these models.

### Main root cause

For most models, the current static provider config does not send the model-specific thinking activation payload that makes hosted NIM emit non-empty reasoning fields.

The baseline results approximate current Pi behavior for this provider:

- DeepSeek V4, Gemma, Kimi, GLM, Qwen3.5: no renderable reasoning in baseline.
- GPT-OSS 120B: renderable reasoning in baseline.
- Qwen3 Coder and Qwen3 Next Instruct: no reasoning expected.

### Request shapes that worked

| Family | Worked request control | Pi static `models.json` expressible today? |
|---|---|---|
| DeepSeek V4 Flash/Pro | top-level `thinking: { type: "enabled" }`, `reasoning_effort: "high"`; also `chat_template_kwargs: { thinking: true, reasoning_effort: "high" }` | Partially. Pi can express the top-level DeepSeek shape with `compat.thinkingFormat: "deepseek"` and model-level `supportsReasoningEffort: true`. Pi cannot express the DeepSeek `chat_template_kwargs` shape today. |
| Gemma 4 31B | `chat_template_kwargs: { enable_thinking: true, preserve_thinking: true }` | Yes, using `compat.thinkingFormat: "qwen-chat-template"`. |
| Kimi K2.6 | `chat_template_kwargs: { thinking: true }` | No. Existing `thinkingFormat` enum has no `chat_template_kwargs.thinking` variant. |
| GLM 5.1 | `chat_template_kwargs: { enable_thinking: true }` | Yes, using `compat.thinkingFormat: "qwen-chat-template"`. Do not use Pi's `zai` format for hosted NIM GLM. |
| GPT-OSS 120B | baseline already emits; `reasoning_effort` also works | Yes. Optionally enable `supportsReasoningEffort: true`. |
| Qwen3.5 122B/397B | `chat_template_kwargs: { enable_thinking: true, preserve_thinking: true }` | Yes, using `compat.thinkingFormat: "qwen-chat-template"`. Top-level `enable_thinking` is rejected by NIM. |
| Qwen3 Coder / Qwen3 Next Instruct | no reasoning fields in baseline; metadata says non-thinking | Mark `reasoning: false`. |

## Solution options

### Option 1 — Static `models.json` updates only, for expressible shapes

Use model-level `compat` overrides and leave Pi core untouched.

Recommended mapping from the evidence:

- `openai/gpt-oss-120b`
  - keep `reasoning: true`
  - optionally set model-level `compat.supportsReasoningEffort: true`
- `deepseek-ai/deepseek-v4-flash`, `deepseek-ai/deepseek-v4-pro`
  - set `reasoning: true`
  - set `compat.thinkingFormat: "deepseek"`
  - set `compat.supportsReasoningEffort: true`
  - set `thinkingLevelMap` so only `high` and `xhigh` are meaningful, e.g. `high: "high"`, `xhigh: "max"`, lower levels `null`
- `google/gemma-4-31b-it`, `z-ai/glm-5.1`, `qwen/qwen3.5-122b-a10b`, `qwen/qwen3.5-397b-a17b`
  - set `reasoning: true`
  - set `compat.thinkingFormat: "qwen-chat-template"`
- `qwen/qwen3-coder-480b-a35b-instruct`, `qwen/qwen3-next-80b-a3b-instruct`
  - set `reasoning: false`
- `moonshotai/kimi-k2.6`
  - cannot be fully fixed with current static config; either leave as non-rendering/baseline or use another option below.

Pros:

- Fastest and lowest-risk change.
- Works for most curated NIM models.
- Uses request shapes that the live hosted endpoint accepted.

Cons:

- Does not solve Kimi.
- DeepSeek would use the accepted top-level DeepSeek shape, not the NIM/vLLM-recommended `chat_template_kwargs` shape.
- Qwen3.5 thinking can consume substantial output budget before visible answer content; in the 512-token probe it hit `length` with reasoning only. In real Pi usage, higher `max_tokens` is likely needed.

### Option 2 — Add new Pi `thinkingFormat` variants, then keep static provider config

Extend Pi's OpenAI completions request builder with new compatibility formats, for example:

- `deepseek-chat-template`: sends `chat_template_kwargs: { thinking: true, reasoning_effort: mappedEffort }`
- `kimi-chat-template`: sends `chat_template_kwargs: { thinking: true }` when Pi thinking is enabled, and optionally `{ thinking: false }` when off

The response parser can stay as-is because NIM emits `reasoning_content`/`reasoning`, which Pi already recognizes.

Pros:

- Cleanest long-term model metadata solution.
- Solves Kimi without reimplementing provider streaming.
- Lets DeepSeek use the NIM/vLLM-recommended request shape.

Cons:

- Requires Pi core change or upstream PR.
- A local patch to the installed package is not durable across Pi upgrades unless carried as a patch.

### Option 3 — Add a generic static `extraBodyWhenThinking` / `reasoningRequest` config feature to Pi

Instead of adding one `thinkingFormat` constant per provider/model family, add a schema-supported generic way to merge static request extras when Pi thinking is enabled, e.g. conceptually:

```json
{
  "compat": {
    "thinkingRequest": {
      "on": { "chat_template_kwargs": { "thinking": true } },
      "off": { "chat_template_kwargs": { "thinking": false } }
    }
  }
}
```

Pros:

- Avoids proliferating provider-specific enum values.
- Would express Kimi, DeepSeek chat-template, and future NIM/vLLM variants.
- Keeps static `models.json` as the source of truth.

Cons:

- Larger Pi core/schema change.
- Needs careful merging semantics and tests so users cannot accidentally override core fields like `messages` or `stream` unsafely.

### Option 4 — Custom NVIDIA NIM extension/provider wrapper

Register a custom provider with `streamSimple`, inject model-specific reasoning request controls, and transform streamed NIM chunks into Pi `thinking_*` events.

Pros:

- Can solve every tested shape immediately, including Kimi.
- Does not require patching the installed Pi core.
- Can keep model-specific quirks isolated in this repository.

Cons:

- More code to maintain.
- Must preserve OpenAI-compatible details Pi already handles: usage parsing, tool calls, aborts, Unicode sanitization, errors, finish reasons, and future provider behavior.
- Higher risk than using the existing OpenAI completions provider where possible.

### Option 5 — Inline `<think>` splitting in renderer/provider

Teach Pi to split inline `<think>...</think>` from `content` into thinking blocks.

Pros:

- Useful for some providers/models that leak reasoning as normal text.

Cons:

- Not indicated by this probe: all tested NIM outputs had `content_contains_think_tags: false`.
- Could misclassify ordinary XML/HTML-like text.
- Not recommended as the primary fix for these curated NIM models.

## Recommendation

Start with Option 1 for the models that current Pi can express safely:

1. Enable model-specific static compat for DeepSeek, Gemma, GLM, GPT-OSS, and Qwen3.5.
2. Mark Qwen3 Coder and Qwen3 Next Instruct as `reasoning: false`.
3. Treat Kimi as requiring Option 2 or Option 4.

If Kimi reasoning rendering is important, prefer Option 2 if you are willing to modify/upstream Pi core; otherwise use Option 4 as an extension-level workaround.
