---
task_number: 11
title: Add operator docs and run the full verification suite
status: Ready for implementation
lane: ready
plan_path: docs/superpowers/plans/2026-04-30-familyos-telegram.md
spec_path: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md
next_prompt: |-
  You are implementing Task 11 from the FamilyOS Telegram MVP implementation plan.

  Start from this ticket:
  - Ticket: in-progress/ready/task-11-operator-docs-and-full-verification.md
  - Plan: docs/superpowers/plans/2026-04-30-familyos-telegram.md
  - Spec: docs/superpowers/specs/2026-04-30-familyos-telegram-design.md

  Work only on this task. Follow the plan excerpt in this ticket exactly.
  When implementation and verification are complete:
  - move this ticket to in-progress/review/
  - set status to Ready for review
  - set lane to review
  - replace next_prompt with the review prompt template from this ticket or an updated equivalent
  - add brief notes about verification and any follow-up concerns
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

- [ ] **Step 1: Write the operator README**

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

- [ ] **Step 2: Run the full suite**

Run: `cd services/familyos && npm run test && npm run typecheck`
Expected: PASS — all unit and integration tests green, no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add services/familyos/README.md
git commit -m "docs(familyos): add operator runbook"
```

---
