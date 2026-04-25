## Minor

- Rule ID collision: If the combined rules ends up with conflicting rule IDs, how to handle? Declare entire rules config invalid, no-op and log? Or just skip the duplicate rule ID and log?
- Rule ID format: Numeric? Kebab case? Either is fine, but should be specified in the design. I'd lean kebab case.
- CRLF vs LF mismatches between authored target and runtime prompt are a classic silent fail. Either normalise at compare time or log the prompt's line-ending convention so users can debug.

## Edge cases

A few validation edge cases worth pinning down

`replacement: ""` (delete on match) — probably fine, but make it explicit it's allowed.
`target: ""` for literal rules — should be invalid; reject at load.
A full rule with `enabled: false` should behave identically to a disable-only override of the same id. Worth stating explicitly so the validator doesn't reject the "redundant" form.

Project-first file lookup regardless of rule origin is what enables Scenario 4 (override content without redefining the rule). That's elegant. But it also means: if a project has a file with the same name as an inherited rule's file for unrelated reasons, the rule silently runs with different content. That's the worst kind of silent change — the rule still applies, just with a payload the rule's author didn't intend.

Therefore, make sure the file-resolution log line names both candidate paths and which one won, every time. You list this in logged events; just be sure the log entry is unambiguous.