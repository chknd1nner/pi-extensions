# Nvidia NIM Endpoint — Model Metadata

> **Date researched:** 2 June 2026
> **Endpoint:** `https://integrate.api.nvidia.com/v1`
> **Pricing note:** NIM free tier is rate-limited (no per-token cost). Costs below reflect the free Developer Program tier. Paid production pricing requires NVIDIA AI Enterprise or partner endpoints — contact sales for quotes.

---

## deepseek-ai/deepseek-v4-flash

```js
{
  input: ["text"],
  contextWindow: 1000000,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 284B total / 13B active |
| Context | 1M tokens (model native); NIM free tier may impose lower practical limits |
| Max output | 16384 — this is the value used in NIM playground examples; model natively supports higher |
| Reasoning | Supports three modes: Non-think, Think High, Think Max via `chat_template_kwargs` |
| Released on NIM | 23 Apr 2026 |

---

## deepseek-ai/deepseek-v4-pro

```js
{
  input: ["text"],
  contextWindow: 1000000,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 1.6T total / 49B active |
| Context | 1M tokens; hybrid CSA + HCA attention |
| Max output | 16384 — NIM playground default; model natively supports higher |
| Reasoning | Three modes: Non-think, Think High, Think Max |
| Released on NIM | 23 Apr 2026 |

---

## google/gemma-4-31b-it

```js
{
  input: ["text", "image", "video"],
  contextWindow: 262144,
  maxTokens: 131072,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | Dense Transformer, 30.7B params |
| Context | 256K tokens; hybrid sliding-window + global attention with p-RoPE |
| Max output | 131072 — per NVIDIA NVFP4 benchmarking config (`max_new_tokens`); NIM free tier may cap lower |
| Modalities | Text, Image (RGB), Video (MP4/WebM) — listed under Visual Models on NIM |
| License | Apache 2.0 |
| Released on NIM | 2 Apr 2026 |

---

## moonshotai/kimi-k2.6

```js
{
  input: ["text", "image", "video"],
  contextWindow: 262144,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 1T total / 32B active (384 experts, top-8 + 1 shared) |
| Context | 262,144 tokens; MLA (Multi-head Latent Attention) for KV cache efficiency |
| Max output | 16384 — NIM playground default; model supports up to 98,304 via direct Moonshot API |
| Vision | MoonViT 400M encoder; native image + video input |
| Reasoning | On by default; disable with `chat_template_kwargs: { thinking: false }` |
| Agentic | Supports orchestration of up to 300 sub-agents / 4,000 coordinated steps |
| License | Modified MIT |
| Released on NIM | ~21 Apr 2026 |

---

## z-ai/glm-5.1

```js
{
  input: ["text"],
  contextWindow: 131072,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | GlmMoeDSA (Gated DeltaNet + standard attention + sparse MoE), 754B total / ~40B active |
| Context | 131,072 on NIM endpoint (per NIM model card); Z.AI direct API advertises 204,800 |
| Max output | 16384 — NIM playground default; Z.AI docs list `maxTokens: 131072` natively; freellm.net reports 8K cap on NIM free tier |
| Reasoning | Supports reasoning traces; designed for 8-hour sustained autonomous execution |
| License | MIT |
| Released on NIM | ~18 Apr 2026 |

---

## openai/gpt-oss-120b

```js
{
  input: ["text"],
  contextWindow: 131072,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 117B total / 5.1B active (128 experts, SwiGLU activations, learned attention sinks) |
| Context | 128K (131,072 tokens); alternating full-context and sliding 128-token window attention with RoPE |
| Max output | 16384 — NIM playground default; OpenRouter reports model supports up to 131,072 |
| Reasoning | Chain-of-thought with adjustable effort (low/medium/high); uses OpenAI "harmony" response format |
| Precision | Native MXFP4 — fits on a single 80GB GPU |
| License | Apache 2.0 |
| Released on NIM | 5 Aug 2025 |

---

## qwen/qwen3-coder-480b-a35b-instruct

```js
{
  input: ["text"],
  contextWindow: 262144,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 480B total / 35B active (160 experts, 8 active per forward pass, GQA with 96 query / 8 KV heads) |
| Context | 262,144 native; extendable to 1M with YaRN |
| Max output | 16384 — NIM playground default; OpenRouter reports 65,536; model natively supports higher |
| Mode | **Non-thinking only** — does not produce `<think>` blocks |
| Agentic | Function calling, tool choice, optimised for Qwen Code / CLINE workflows |
| License | Apache 2.0 |
| Released on NIM | ~Apr 2026 |

---

## qwen/qwen3-next-80b-a3b-instruct

```js
{
  input: ["text"],
  contextWindow: 262144,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | Hybrid Transformer-Mamba MoE, 80B total / 3.9B active (Gated DeltaNet + Gated Attention) |
| Context | 262,144 native; extendable to 1M with YaRN |
| Max output | 16384 — NIM playground default |
| Mode | **Instruct (non-thinking) only** — for thinking variant see `qwen3-next-80b-a3b-thinking` |
| Features | Multi-Token Prediction (MTP) for accelerated inference; ultra-low activation ratio |
| License | Apache 2.0 |
| Released on NIM | 18 Sep 2025 |

---

## qwen/qwen3.5-122b-a10b

```js
{
  input: ["text", "image", "video"],
  contextWindow: 262144,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 122B total / 10B active (Qwen, Gated DeltaNet hybrid attention) |
| Context | 262,144 native; extendable to ~1M with YaRN |
| Max output | 16384 — NIM playground default |
| Modalities | Text, Image (RGB), Video (mp4/mov/webm) — listed under LLMs on NIM API but model card confirms multimodal |
| Features | Reasoning mode via `enable_thinking`; native function calling; early-fusion vision-language |
| License | Apache 2.0 |
| Released on NIM | 6 Mar 2026 |

---

## qwen/qwen3.5-397b-a17b

```js
{
  input: ["text", "image", "video"],
  contextWindow: 262144,
  maxTokens: 16384,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  }
}
```

| Field | Notes |
|-------|-------|
| Architecture | MoE, 397B total / 17B active (512 experts, top-10 routing + 1 shared, Gated DeltaNet hybrid) |
| Context | 262,144 native; extendable to ~1M with YaRN; hosted Qwen3.5-Plus provides 1M out of the box |
| Max output | 16384 — NIM playground default |
| Modalities | Text, Image, Video — listed under Multimodal on NIM API |
| Features | Reasoning mode via `enable_thinking`; native function calling; early-fusion vision-language; 201 languages |
| License | Apache 2.0 |
| Released on NIM | ~Feb 2026 |

---

## Summary Table

| Model | Input | Context | Max Out | Params (total/active) | Status |
|-------|-------|---------|---------|-----------------------|--------|
| `deepseek-v4-flash` | text | 1M | 16K | 284B / 13B | ✅ Active |
| `deepseek-v4-pro` | text | 1M | 16K | 1.6T / 49B | ✅ Active |
| `gemma-4-31b-it` | text, image, video | 256K | 131K | 30.7B dense | ✅ Active |
| `gpt-oss-120b` | text | 131K | 16K | 117B / 5.1B | ✅ Active |
| `kimi-k2.6` | text, image, video | 262K | 16K | 1T / 32B | ✅ Active |
| `glm-5.1` | text | 131K | 16K | 754B / 40B | ✅ Active |
| `qwen3-coder-480b-a35b` | text | 262K | 16K | 480B / 35B | ✅ Active |
| `qwen3-next-80b-a3b` | text | 262K | 16K | 80B / 3.9B | ✅ Active |
| `qwen3.5-122b-a10b` | text, image, video | 262K | 16K | 122B / 10B | ✅ Active |
| `qwen3.5-397b-a17b` | text, image, video | 262K | 16K | 397B / 17B | ✅ Active |

> **⚠️ Caveat:** `maxTokens` values are best-effort from NIM playground defaults and documentation. The NIM free tier imposes undocumented rate limits and may further cap output tokens below the values shown. Always verify against the live endpoint. Context windows shown are from official NIM model cards and may differ from the model's native maximum when accessed via other providers.
