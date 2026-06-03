# NVIDIA NIM Models
Generated: 2026-06-02T07:07:41.413488+00:00
Model-list endpoint: `https://integrate.api.nvidia.com/v1/models`
Total models: 118
## Authentication and base URLs
Use the API key stored in `NVIDIA_API_KEY`:
```bash
export NVIDIA_API_KEY="nvapi-..."
```
Hosted NVIDIA API Catalog / NIM endpoints found during testing:

| Purpose | Base URL | Notes |
|---|---|---|
| LLM chat + model listing | `https://integrate.api.nvidia.com/v1` | Tested with `/models`, `/chat/completions`, and `/embeddings`. |
| Retrieval reranking | `https://ai.api.nvidia.com/v1/retrieval/nvidia` | Tested with `/reranking`. |

Self-hosted NIM containers also expose additional local endpoints described by NVIDIA docs, usually under `http://localhost:8000`, such as `/v1/completions`, `/v1/responses`, `/v1/messages`, `/tokenize`, `/detokenize`, `/v1/health/*`, `/v1/metadata`, `/v1/version`, `/v1/manifest`, `/v1/license`, and `/v1/metrics`. The hosted `integrate.api.nvidia.com` endpoint returned `404` for `/v1/completions` and `/v1/responses` in this test.
## List models
```bash
curl -sS \
  -H "Authorization: Bearer ${NVIDIA_API_KEY}" \
  -H "Accept: application/json" \
  https://integrate.api.nvidia.com/v1/models
```
## Chat completions
NVIDIA documents `/v1/chat/completions` as OpenAI-compatible. Required fields are `model` and `messages`. A `system` message is optional but must be first if present. NVIDIA's model-specific docs identify these optional request fields: `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `max_tokens`, `stream`, `stop`, and example usage of `seed`. Tool calling and streaming are model-dependent.

Tested working model for the examples below: `minimaxai/minimax-m2.7`.

Other hosted chat models verified with `HTTP 200` in this environment:

- `deepseek-ai/deepseek-v4-flash`
- `google/gemma-4-31b-it` (interpreting `gemma--31b-it` as this listed model ID)

### Successful curl with optional parameters
```bash
curl -sS https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer ${NVIDIA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "minimaxai/minimax-m2.7",
    "messages": [
      {"role": "system", "content": "Answer with exactly one short sentence."},
      {"role": "user", "content": "Confirm that this NVIDIA NIM chat completion request worked."}
    ],
    "temperature": 0.2,
    "top_p": 0.9,
    "max_tokens": 32,
    "stream": false,
    "stop": ["\n\n"],
    "frequency_penalty": 0,
    "presence_penalty": 0,
    "seed": 42
  }'
```

The call above returned `HTTP 200` during testing. Response shape (exact message fields vary by model; reasoning models may include `reasoning_content`):
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "minimaxai/minimax-m2.7",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "...", "reasoning_content": "..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 34, "completion_tokens": 32, "total_tokens": 66}
}
```
### Chat request JSON only
```json
{
  "model": "minimaxai/minimax-m2.7",
  "messages": [
    {"role": "system", "content": "Answer with exactly one short sentence."},
    {"role": "user", "content": "Confirm that this NVIDIA NIM chat completion request worked."}
  ],
  "temperature": 0.2,
  "top_p": 0.9,
  "max_tokens": 32,
  "stream": false,
  "stop": ["\n\n"],
  "frequency_penalty": 0,
  "presence_penalty": 0,
  "seed": 42
}
```
### Streaming variant
Set `stream` to `true`; the response is sent as Server-Sent Events with `data:` chunks and a final `data: [DONE]`.
```json
{
  "model": "minimaxai/minimax-m2.7",
  "messages": [{"role": "user", "content": "Explain NVIDIA NIM in one sentence."}],
  "max_tokens": 64,
  "temperature": 0.2,
  "stream": true
}
```
## Embeddings
Endpoint: `POST https://integrate.api.nvidia.com/v1/embeddings`. Required fields are `model` and `input`. Optional fields found in NVIDIA docs: `input_type` (`query` or `passage`, required by some NVIDIA embedding models), `encoding_format` (`float` or `base64`, default `float`), `truncate` (`NONE`, `START`, or `END`, default `NONE`), and `user` (present for API compliance and ignored).

Tested with `nvidia/nv-embedqa-e5-v5` and returned `HTTP 200`, one 1024-dimensional vector.
```bash
curl -sS https://integrate.api.nvidia.com/v1/embeddings \
  -H "Authorization: Bearer ${NVIDIA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/nv-embedqa-e5-v5",
    "input": "What is NVIDIA NIM?",
    "input_type": "query",
    "encoding_format": "float",
    "truncate": "NONE",
    "user": "docs-example"
  }'
```
## Reranking
Endpoint: `POST https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking`. Required fields are `model`, `query.text`, and `passages[].text`. Optional field found in NVIDIA docs: `truncate` (`NONE` or `END`, default `NONE`). NVIDIA docs state up to 512 passages per request.

The hosted reranking endpoint accepted `nvidia/rerank-qa-mistral-4b` during testing and returned `HTTP 200`.
```bash
curl -sS https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking \
  -H "Authorization: Bearer ${NVIDIA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/rerank-qa-mistral-4b",
    "query": {"text": "What is GPU computing?"},
    "passages": [
      {"text": "GPU computing uses graphics processors for parallel workloads."},
      {"text": "A banana is a yellow fruit."}
    ],
    "truncate": "END"
  }'
```

Response shape:
```json
{
  "rankings": [
    {"index": 0, "logit": 5.7578125},
    {"index": 1, "logit": -16.9375}
  ]
}
```
## vLLM / self-hosted NIM extended options
NVIDIA's local NIM LLM docs say the inference backend is vLLM and refer to vLLM's OpenAI-compatible server for full schemas. These extra fields are deployment- and model-dependent; use them directly in raw JSON requests, or as `extra_body` when using the OpenAI Python client. Do not assume every hosted model accepts every field.

Additional sampling options found in vLLM docs: `use_beam_search`, `top_k`, `min_p`, `repetition_penalty`, `length_penalty`, `stop_token_ids`, `include_stop_str_in_output`, `ignore_eos`, `min_tokens`, `skip_special_tokens`, `spaces_between_special_tokens`, `truncate_prompt_tokens`, `prompt_logprobs`, `allowed_token_ids`, and `bad_words`.

Additional chat/template/debug options found in vLLM docs: `echo`, `add_generation_prompt`, `continue_final_message`, `add_special_tokens`, `documents`, `chat_template`, `chat_template_kwargs`, `media_io_kwargs`, `mm_processor_kwargs`, `structured_outputs`, `priority`, `request_id`, `return_tokens_as_token_ids`, `return_token_ids`, `return_prompt_text`, `cache_salt`, `kv_transfer_params`, `vllm_xargs`, and `repetition_detection`.

Structured-output options found in NVIDIA/vLLM docs: `guided_choice`, `guided_regex`, `guided_json`, `guided_grammar`, `guided_whitespace_pattern`, and `guided_decoding_backend`. NVIDIA recommends `guided_json` for reliability in NIM structured generation docs.

Example extended JSON for a self-hosted NIM/vLLM-compatible chat endpoint:
```json
{
  "model": "minimaxai/minimax-m2.7",
  "messages": [{"role": "user", "content": "Classify: vLLM is wonderful!"}],
  "max_tokens": 16,
  "temperature": 0.2,
  "top_p": 0.9,
  "top_k": 50,
  "min_p": 0.0,
  "repetition_penalty": 1.0,
  "length_penalty": 1.0,
  "stop": ["\n"],
  "stop_token_ids": [],
  "include_stop_str_in_output": false,
  "ignore_eos": false,
  "min_tokens": 0,
  "skip_special_tokens": true,
  "spaces_between_special_tokens": true,
  "truncate_prompt_tokens": null,
  "prompt_logprobs": null,
  "allowed_token_ids": null,
  "bad_words": [],
  "echo": false,
  "add_generation_prompt": true,
  "continue_final_message": false,
  "add_special_tokens": false,
  "documents": [{"title": "NIM", "text": "NVIDIA NIM serves models through inference microservices."}],
  "chat_template_kwargs": {"enable_thinking": false},
  "structured_outputs": {"choice": ["positive", "negative"]},
  "guided_choice": ["positive", "negative"],
  "priority": 0,
  "request_id": "docs-example-001",
  "return_tokens_as_token_ids": false,
  "return_token_ids": false,
  "return_prompt_text": false,
  "cache_salt": null,
  "vllm_xargs": null
}
```
## Sources consulted
- NVIDIA API Catalog LLM APIs: https://docs.api.nvidia.com/nim/reference/llm-apis
- NVIDIA NIM LLM API reference: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
- NVIDIA model-specific chat completion docs: https://docs.api.nvidia.com/nim/reference/meta-llama-3_3-70b-instruct-infer
- NVIDIA NIM structured generation: https://docs.nvidia.com/nim/large-language-models/latest/structured-generation.html
- NVIDIA NIM reasoning models: https://docs.nvidia.com/nim/large-language-models/latest/reasoning-model.html
- NVIDIA embeddings docs: https://docs.api.nvidia.com/nim/reference/nvidia-nv-embed-v1-infer
- NVIDIA reranking docs: https://docs.nvidia.com/nim/nemo-retriever/text-reranking/latest/using-reranking.html
- vLLM OpenAI-compatible server docs: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/
## Available models
| Model ID | Owner | Object | Created |
|---|---|---|---|
| `01-ai/yi-large` | `01-ai` | `model` | `735790403` |
| `abacusai/dracarys-llama-3.1-70b-instruct` | `abacusai` | `model` | `735790403` |
| `adept/fuyu-8b` | `adept` | `model` | `735790403` |
| `ai21labs/jamba-1.5-large-instruct` | `ai21labs` | `model` | `735790403` |
| `aisingapore/sea-lion-7b-instruct` | `aisingapore` | `model` | `735790403` |
| `baai/bge-m3` | `baai` | `model` | `735790403` |
| `bigcode/starcoder2-15b` | `bigcode` | `model` | `735790403` |
| `bytedance/seed-oss-36b-instruct` | `bytedance` | `model` | `735790403` |
| `databricks/dbrx-instruct` | `databricks` | `model` | `735790403` |
| `deepseek-ai/deepseek-coder-6.7b-instruct` | `deepseek-ai` | `model` | `735790403` |
| `deepseek-ai/deepseek-v4-flash` | `deepseek-ai` | `model` | `735790403` |
| `deepseek-ai/deepseek-v4-pro` | `deepseek-ai` | `model` | `735790403` |
| `google/codegemma-1.1-7b` | `google` | `model` | `735790403` |
| `google/codegemma-7b` | `google` | `model` | `735790403` |
| `google/deplot` | `google` | `model` | `735790403` |
| `google/gemma-2-2b-it` | `google` | `model` | `735790403` |
| `google/gemma-2b` | `google` | `model` | `735790403` |
| `google/gemma-3-12b-it` | `google` | `model` | `735790403` |
| `google/gemma-3-4b-it` | `google` | `model` | `735790403` |
| `google/gemma-3n-e2b-it` | `google` | `model` | `735790403` |
| `google/gemma-3n-e4b-it` | `google` | `model` | `735790403` |
| `google/gemma-4-31b-it` | `google` | `model` | `735790403` |
| `google/recurrentgemma-2b` | `google` | `model` | `735790403` |
| `ibm/granite-3.0-3b-a800m-instruct` | `ibm` | `model` | `735790403` |
| `ibm/granite-3.0-8b-instruct` | `ibm` | `model` | `735790403` |
| `ibm/granite-34b-code-instruct` | `ibm` | `model` | `735790403` |
| `ibm/granite-8b-code-instruct` | `ibm` | `model` | `735790403` |
| `meta/codellama-70b` | `meta` | `model` | `735790403` |
| `meta/llama-3.1-70b-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.1-8b-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.2-11b-vision-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.2-1b-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.2-3b-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.2-90b-vision-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-3.3-70b-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-4-maverick-17b-128e-instruct` | `meta` | `model` | `735790403` |
| `meta/llama-guard-4-12b` | `meta` | `model` | `735790403` |
| `meta/llama2-70b` | `meta` | `model` | `735790403` |
| `microsoft/kosmos-2` | `microsoft` | `model` | `735790403` |
| `microsoft/phi-3-vision-128k-instruct` | `microsoft` | `model` | `735790403` |
| `microsoft/phi-3.5-moe-instruct` | `microsoft` | `model` | `735790403` |
| `microsoft/phi-4-mini-instruct` | `microsoft` | `model` | `735790403` |
| `microsoft/phi-4-multimodal-instruct` | `microsoft` | `model` | `735790403` |
| `minimaxai/minimax-m2.7` | `minimaxai` | `model` | `735790403` |
| `mistralai/codestral-22b-instruct-v0.1` | `mistralai` | `model` | `735790403` |
| `mistralai/ministral-14b-instruct-2512` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-7b-instruct-v0.3` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-large` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-large-2-instruct` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-large-3-675b-instruct-2512` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-medium-3.5-128b` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-nemotron` | `mistralai` | `model` | `735790403` |
| `mistralai/mistral-small-4-119b-2603` | `mistralai` | `model` | `735790403` |
| `mistralai/mixtral-8x22b-v0.1` | `mistralai` | `model` | `735790403` |
| `mistralai/mixtral-8x7b-instruct-v0.1` | `mistralai` | `model` | `735790403` |
| `moonshotai/kimi-k2.6` | `moonshotai` | `model` | `735790403` |
| `nv-mistralai/mistral-nemo-12b-instruct` | `nv-mistralai` | `model` | `735790403` |
| `nvidia/ai-synthetic-video-detector` | `nvidia` | `model` | `735790403` |
| `nvidia/cosmos-reason2-8b` | `nvidia` | `model` | `735790403` |
| `nvidia/embed-qa-4` | `nvidia` | `model` | `735790403` |
| `nvidia/gliner-pii` | `nvidia` | `model` | `735790403` |
| `nvidia/ising-calibration-1-35b-a3b` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemoguard-8b-content-safety` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemoguard-8b-topic-control` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-51b-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-70b-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-nano-8b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.2-nv-embedqa-1b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.3-nemotron-super-49b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-nemotron-embed-1b-v2` | `nvidia` | `model` | `735790403` |
| `nvidia/llama-nemotron-embed-vl-1b-v2` | `nvidia` | `model` | `735790403` |
| `nvidia/llama3-chatqa-1.5-70b` | `nvidia` | `model` | `735790403` |
| `nvidia/mistral-nemo-minitron-8b-8k-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/nemoretriever-parse` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-3-content-safety` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-3-nano-30b-a3b` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-3-super-120b-a12b` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-4-340b-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-4-340b-reward` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-content-safety-reasoning-4b` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-mini-4b-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-nano-12b-v2-vl` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-nano-3-30b-a3b` | `nvidia` | `model` | `735790403` |
| `nvidia/nemotron-parse` | `nvidia` | `model` | `735790403` |
| `nvidia/neva-22b` | `nvidia` | `model` | `735790403` |
| `nvidia/nv-embed-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/nv-embedcode-7b-v1` | `nvidia` | `model` | `735790403` |
| `nvidia/nv-embedqa-e5-v5` | `nvidia` | `model` | `735790403` |
| `nvidia/nv-embedqa-mistral-7b-v2` | `nvidia` | `model` | `735790403` |
| `nvidia/nvclip` | `nvidia` | `model` | `735790403` |
| `nvidia/nvidia-nemotron-nano-9b-v2` | `nvidia` | `model` | `735790403` |
| `nvidia/riva-translate-4b-instruct` | `nvidia` | `model` | `735790403` |
| `nvidia/riva-translate-4b-instruct-v1.1` | `nvidia` | `model` | `735790403` |
| `nvidia/vila` | `nvidia` | `model` | `735790403` |
| `openai/gpt-oss-120b` | `openai` | `model` | `735790403` |
| `openai/gpt-oss-20b` | `openai` | `model` | `735790403` |
| `qwen/qwen3-coder-480b-a35b-instruct` | `qwen` | `model` | `735790403` |
| `qwen/qwen3-next-80b-a3b-instruct` | `qwen` | `model` | `735790403` |
| `qwen/qwen3.5-122b-a10b` | `qwen` | `model` | `735790403` |
| `qwen/qwen3.5-397b-a17b` | `qwen` | `model` | `735790403` |
| `sarvamai/sarvam-m` | `sarvamai` | `model` | `735790403` |
| `snowflake/arctic-embed-l` | `snowflake` | `model` | `735790403` |
| `stepfun-ai/step-3.5-flash` | `stepfun-ai` | `model` | `735790403` |
| `stepfun-ai/step-3.7-flash` | `stepfun-ai` | `model` | `735790403` |
| `stockmark/stockmark-2-100b-instruct` | `stockmark` | `model` | `735790403` |
| `upstage/solar-10.7b-instruct` | `upstage` | `model` | `735790403` |
| `writer/palmyra-creative-122b` | `writer` | `model` | `735790403` |
| `writer/palmyra-fin-70b-32k` | `writer` | `model` | `735790403` |
| `writer/palmyra-med-70b` | `writer` | `model` | `735790403` |
| `writer/palmyra-med-70b-32k` | `writer` | `model` | `735790403` |
| `z-ai/glm-5.1` | `z-ai` | `model` | `735790403` |
| `zyphra/zamba2-7b-instruct` | `zyphra` | `model` | `735790403` |
