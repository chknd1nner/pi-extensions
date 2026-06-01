import { truncateHead } from "@earendil-works/pi-coding-agent";

export function formatStoredContentForTool(input: { content: string; savedPath?: string; maxOutputChars?: number }): string {
  const maxOutputChars = input.maxOutputChars ?? 50_000;
  const truncation = truncateHead(input.content, { maxBytes: maxOutputChars, maxLines: 2000 });
  if (!truncation.truncated) return truncation.content;

  const preview = truncation.content.length > 0 ? truncation.content : input.content.slice(0, maxOutputChars);
  const suffix = input.savedPath
    ? `[Output truncated. Full content saved to ${input.savedPath}]`
    : "[Output truncated]";

  return `${preview}\n\n${suffix}`;
}

export function formatLargePdfStoredContent(input: { title: string; url: string; savedPath: string; content: string; pages?: number; chars?: number; previewChars?: number }): string {
  const previewChars = input.previewChars ?? 2000;
  return [
    "PDF content is stored on disk.",
    "",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    input.pages !== undefined ? `Pages: ${input.pages}` : undefined,
    `Characters: ${input.chars ?? input.content.length}`,
    `Saved markdown: ${input.savedPath}`,
    "",
    "Preview:",
    input.content.slice(0, previewChars),
    "",
    "Use the built-in read tool on the saved Markdown path for the full content."
  ].filter(Boolean).join("\n");
}
