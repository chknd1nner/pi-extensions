const CODE_BLOCK_OPEN = "<pre><code>";
const CODE_BLOCK_CLOSE = "</code></pre>";

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function tokenizeMarkdown(text: string) {
  return text.split(/(```(?:[a-zA-Z0-9_-]+)?\n[\s\S]*?```)/g).filter(Boolean);
}

function renderToken(token: string) {
  const match = token.match(/^```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/);
  if (match) {
    return `${CODE_BLOCK_OPEN}${escapeHtml(match[1]!.trimEnd())}${CODE_BLOCK_CLOSE}`;
  }
  return escapeHtml(token);
}

function splitTextBlock(block: string, maxLength: number) {
  if (block.length <= maxLength) return [block];

  const chunks: string[] = [];
  let remaining = block;

  while (remaining.length > maxLength) {
    const newlineBreak = remaining.lastIndexOf("\n", maxLength - 1);
    const splitAt = newlineBreak > 0 ? newlineBreak + 1 : maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function splitRenderedCodeBlock(block: string, maxLength: number) {
  const maxCodeLength = maxLength - CODE_BLOCK_OPEN.length - CODE_BLOCK_CLOSE.length;
  if (maxCodeLength <= 0) {
    throw new Error("maxLength is too small to fit a Telegram code block wrapper");
  }

  const body = block.slice(CODE_BLOCK_OPEN.length, block.length - CODE_BLOCK_CLOSE.length);
  const bodyChunks = splitTextBlock(body, maxCodeLength);
  return bodyChunks.map((part) => `${CODE_BLOCK_OPEN}${part}${CODE_BLOCK_CLOSE}`);
}

function splitBlock(block: string, maxLength: number) {
  if (block.length <= maxLength) return [block];
  if (block.startsWith(CODE_BLOCK_OPEN) && block.endsWith(CODE_BLOCK_CLOSE)) {
    return splitRenderedCodeBlock(block, maxLength);
  }
  return splitTextBlock(block, maxLength);
}

export function formatReplyForTelegram(text: string, maxLength = 4096): string[] {
  const blocks = tokenizeMarkdown(text).map(renderToken);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    for (const part of splitBlock(block, maxLength)) {
      if (current.length + part.length <= maxLength) {
        current += part;
        continue;
      }

      if (current) {
        chunks.push(current);
      }
      current = part;
    }
  }

  if (current) chunks.push(current);
  return chunks.map((chunk) => chunk || "Done.");
}
