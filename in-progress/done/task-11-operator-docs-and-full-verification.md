---
task_number: 11
title: Add operator docs and run the full verification suite
status: Done
lane: done
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are reviewing Task 11 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
review_prompt_template: |-
  You are reviewing Task 11 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket and the current git diff.
  Review only the scope in this ticket plan excerpt.
  If the task passes review:
  - move this ticket to in-progress/done/
  - set status to Done
  - set lane to done
  - add a short approval note

  If the task needs changes:
  - move this ticket to in-progress/needs-fix/
  - set status to Needs fix
  - set lane to needs-fix
  - replace next_prompt with a fix-focused prompt
  - record the review findings clearly in the ticket or a sibling review note
---

# Task 11 — Add operator docs and run the full verification suite

## Plan excerpt


**Files:**
- Create: `services/familyos/README.md`

- [x] **Step 1: Write the operator README**

Create `services/familyos/README.md`:

````markdown
# FamilyOS Service

Telegram-first FamilyOS MVP built on the Pi SDK.

## Run from this repository

```bash
cd services/familyos
npm install
export TELEGRAM_BOT_TOKEN=123456:replace-me
npm start
```

The service discovers the FamilyOS root by walking upward until it finds `config/familyos.json`.

## Runtime directories

FamilyOS uses the repository root for runtime assets and data:

- `config/familyos.json` — root FamilyOS config
- `agents/default/` — shipped default agent bundle
- `users/<slug>/user.json` — manual registration manifests
- `users/<slug>/state.json` — persisted active session + active agent
- `users/<slug>/home/` — user workspace root
- `logs/audit.jsonl` — append-only audit log
- `.familyos-pi/` — shared Pi auth, models, settings, and session store

## MVP decisions to remember

- The one-shot handoff text lives in `services/familyos/src/pi/handoff.ts` for MVP. FamilyOS does not use `agents/_system/handoff.md` yet.
- FamilyOS intentionally defers per-session `thinkingLevel` controls in MVP.

## Manual registration

Create `users/<slug>/user.json` before the person can use the bot:

```json
{
  "id": "martin",
  "displayName": "Martin",
  "channels": {
    "telegram": {
      "userIds": ["123456789"]
    }
  }
}
```

FamilyOS lazily scaffolds the rest of the user home on first successful use.

## Verification

```bash
cd services/familyos
npm run test
npm run typecheck
```
````

- [x] **Step 2: Run the full suite**

Run: `cd services/familyos && npm run test && npm run typecheck`
Expected: PASS — all unit and integration tests green, no TypeScript errors

- [x] **Step 3: Commit**

```bash
git add services/familyos/README.md
git commit -m "docs(familyos): add operator runbook"
```

---

## Implementation notes

- Verification run:
  - `cd services/familyos && npm run test && npm run typecheck`
  - Passed: `18` test files and `49` tests green, followed by a clean TypeScript no-emit check.
- Follow-up concerns:
  - None identified within this task scope.

---

## Review approval

**Approved.** Reviewed Task 11 against the ticket scope and found no blocking issues in the operator README or the full verification run.

Fresh verification evidence:
- `cd services/familyos && npm run test && npm run typecheck` → passed (`18` test files, `49` tests), followed by a clean TypeScript no-emit check.

Scope check:
- `services/familyos/README.md` exists and matches the runbook content requested in the ticket.
- The documented runtime layout and MVP reminders align with the current implementation, including root discovery via `config/familyos.json`, shared Pi state in `.familyos-pi/`, the handoff prompt living in `src/pi/handoff.ts`, and the MVP deferral of per-session `thinkingLevel` controls.
