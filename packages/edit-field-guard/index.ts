import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatRepairWarning, sanitizeEditInput } from "./lib.js";

/**
 * edit-field-guard
 *
 * Overrides the built-in `edit` tool with a drop-in replacement that tolerates
 * the malformed inputs agents keep producing — stray `newText2`/`newText3`,
 * typo'd keys like `newTex`, numbered `oldText2`/`newText2` pairs, JSON-string
 * `edits`, and top-level oldText/newText — instead of failing schema validation
 * and forcing a full (token-expensive) re-send.
 *
 * Why an override and not a `tool_call` hook?
 *   In Pi's pipeline, tool arguments are schema-validated BEFORE the `tool_call`
 *   event fires (prepareArguments -> validateToolArguments -> beforeToolCall).
 *   The built-in edit schema is `additionalProperties: false`, so a bad field
 *   throws during validation and the `tool_call` hook never runs. The only
 *   pre-validation seam available to an extension is a tool definition's own
 *   schema + execute. Registering a tool named `edit` replaces the built-in in
 *   the tool registry (extension tools are applied after built-ins by name).
 *
 * Behaviour:
 *   - Lenient schema (additionalProperties allowed, fields optional) so the call
 *     never fails validation. Descriptions still teach the correct shape.
 *   - `execute` sanitises the input, delegates to the real edit implementation,
 *     and — when a repair was needed — prepends a warning to the tool result so
 *     the agent learns, plus a transient UI notice.
 *   - Rendering (diff preview / result) is reused verbatim from the built-in.
 */

// Lenient schema: still advertises oldText/newText so well-behaved models get
// the right hint, but allows extras and makes everything optional so validation
// can never reject the call. All real shape enforcement happens in execute.
const lenientEditItemSchema = Type.Object(
	{
		oldText: Type.Optional(
			Type.String({
				description:
					"Exact text for one targeted replacement. Must be unique in the original file and not overlap with any other edits[].oldText in the same call.",
			}),
		),
		newText: Type.Optional(Type.String({ description: "Replacement text for this targeted edit." })),
	},
	{ additionalProperties: true },
);

const lenientEditSchema = Type.Object(
	{
		path: Type.Optional(Type.String({ description: "Path to the file to edit (relative or absolute)." })),
		edits: Type.Optional(
			Type.Array(lenientEditItemSchema, {
				description:
					"One or more targeted replacements. Each entry must contain EXACTLY oldText and newText. For multiple changes, add multiple {oldText, newText} objects — never numbered (newText2) or extra fields.",
			}),
		),
	},
	{ additionalProperties: true },
);

export default function (pi: ExtensionAPI): void {
	// The real definition is reused for description, prompt metadata, and the
	// diff renderers. The cwd passed here is only used by the real `execute`
	// (which we never call on this instance) and by `renderCall`, which actually
	// reads cwd from the render context — so process.cwd() is a safe binding.
	const real = createEditToolDefinition(process.cwd());

	// Cache real definitions per cwd so we resolve relative paths correctly in
	// execute without rebuilding closures on every call.
	const realByCwd = new Map<string, ReturnType<typeof createEditToolDefinition>>();
	const realFor = (cwd: string) => {
		let def = realByCwd.get(cwd);
		if (!def) {
			def = createEditToolDefinition(cwd);
			realByCwd.set(cwd, def);
		}
		return def;
	};

	const definition: ToolDefinition<typeof lenientEditSchema, unknown, unknown> = {
		name: "edit",
		label: "edit",
		description: real.description,
		promptSnippet: real.promptSnippet,
		promptGuidelines: real.promptGuidelines,
		parameters: lenientEditSchema,
		renderShell: "self",
		// Reuse the built-in diff preview / result renderers.
		renderCall: real.renderCall as ToolDefinition<typeof lenientEditSchema, unknown, unknown>["renderCall"],
		renderResult: real.renderResult as ToolDefinition<typeof lenientEditSchema, unknown, unknown>["renderResult"],
		async execute(
			toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: AgentToolUpdateCallback,
			ctx?: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const { input, repairs, error } = sanitizeEditInput(params);

			if (!input) {
				// Unrecoverable — surface a clear, actionable error to the agent.
				return {
					content: [
						{
							type: "text",
							text:
								`edit failed: ${error ?? "could not parse arguments"}\n\n` +
								"Required shape: { path: string, edits: [{ oldText: string, newText: string }] }.",
						},
					],
					details: {},
				};
			}

			const cwd = ctx?.cwd ?? process.cwd();
			// The built-in edit `execute` ignores its ctx argument; satisfy the
			// non-optional parameter type with whatever we were handed.
			const result = await realFor(cwd).execute(toolCallId, input, signal, onUpdate, ctx as ExtensionContext);

			if (repairs.length === 0) {
				return result as AgentToolResult<unknown>;
			}

			// Repaired: warn the agent in-band and via the UI.
			try {
				ctx?.ui?.notify?.(
					`edit input auto-repaired (${repairs.length} fix${repairs.length === 1 ? "" : "es"}); see tool output.`,
					"warning",
				);
			} catch {
				/* notify is best-effort */
			}

			return {
				...result,
				content: [{ type: "text", text: formatRepairWarning(repairs) }, ...result.content],
			} as AgentToolResult<unknown>;
		},
	};

	pi.registerTool(definition);
}
