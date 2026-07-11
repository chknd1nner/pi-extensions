---
name: Skill_Name
description: Concise one-sentence summary of what the skill does. One-sentence summary of when/why to use it and what specific user requests should trigger this skill.
---

# Purpose

A brief explanation of the skill's core functionality and how it helps users. This should explain the "why" behind the skill's existence (e.g., "automates complex workflows," "provides domain-specific knowledge," "bundles reusable code patterns").

## Variables

Document any configuration values the skill uses. These variables can be referenced in the Cookbook section to control conditional logic. Format: `VARIABLE_NAME: value or type` with optional description.

```
ENABLE_FEATURE_X: true (enable/disable feature X)
API_ENDPOINT: "https://api.example.com" (configurable API endpoint)
TIMEOUT_MS: 5000 (operation timeout in milliseconds)
```

## Instructions

1. **Using bundled scripts/tools**: If this skill includes executable code in `scripts/` or `tools/`, reference them here with what problems they solve.
   - Example: "Read `scripts/process_data.py` to understand how to transform raw input into the required format."

2. **Using bundled references**: If this skill includes documentation in `references/`, explain when to load them.
   - Example: "When the user asks about schema requirements, consult `references/schema.md` for the database structure."

3. **Using bundled assets**: If this skill includes templates or boilerplate in `assets/`, explain what they contain and when to use them.
   - Example: "Use the HTML template in `assets/starter-template/` as a base when creating new documents."

## Workflow

Sequential steps showing how to execute the skill. Reference scripts, references, and assets by path.

1. Understand the user's request and identify what they're trying to accomplish
2. Read: `.claude/skills/skill-name/scripts/tool-name.py` (or reference file path)
3. Determine which approach from the Cookbook applies to this request
4. Execute the appropriate tool/process
5. Return output in the expected format

## Cookbook

Provide conditional patterns showing which approach to use based on the user's request. Use IF/THEN/EXAMPLES format for each scenario. Variables from the Variables section can be checked to control behavior.

### Scenario 1: [Common Use Case]

- **IF**: The user requests [specific behavior/input type] AND `VARIABLE_NAME` is [value]
- **THEN**: Follow this approach:
  1. [Step 1]
  2. [Step 2]
  3. Execute `scripts/tool-name.py` with [parameters]
- **EXAMPLES**:
  - "User says: [example request]"
  - "User says: [example request]"

### Scenario 2: [Another Common Use Case]

- **IF**: The user requests [different behavior/input type] AND `ENABLE_FEATURE_X` is true
- **THEN**: Follow this approach:
  1. [Step 1]
  2. Consult `references/reference-file.md` for [specific guidance]
  3. [Step 3]
- **EXAMPLES**:
  - "User says: [example request]"
  - "User says: [example request]"

### Scenario 3: [Fallback/Default Case]

- **IF**: None of the above scenarios apply OR `VARIABLE_NAME` is [default value]
- **THEN**: Follow this default approach:
  1. [Step 1]
  2. [Step 2]
- **EXAMPLES**:
  - "User says: [example request]"
