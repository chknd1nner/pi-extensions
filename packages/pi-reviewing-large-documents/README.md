# pi-reviewing-large-documents

A π package containing one skill: **reviewing-large-documents** — a hierarchical
review workflow for specs and implementation plans too large (~4k+ lines) to read
whole while preserving reviewer judgment.

A lead reviewer works from `mdedit` outlines and preamble sections only, delegates
deep review of batched sections to isolated workers with a frozen shared context
pack, cross-checks the workers' contract ledgers for cross-boundary defects, and
dispatches bounded targeted probes before writing a severity-tiered review.

Design spec: `docs/superpowers/specs/2026-07-11-reviewing-large-documents-skill-design.md`
in the originating `pi-extensions` monorepo.

## Requirements

- [`mdedit`](https://crates.io/crates/mdedit) on PATH (structured markdown
  outline/extract; the skill fails closed without it).
- The `delegate` extension (`delegate_pack`, `delegate_start`) from
  [pi-delegate-driven-development](https://github.com/chknd1nner/pi-delegate-driven-development).

## Install

Add to a project's `.pi/settings.json`:

```json
{
  "packages": [
    "git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.0",
    "git:github.com/chknd1nner/pi-reviewing-large-documents@v0.1.0"
  ]
}
```

## Layout

```
skills/reviewing-large-documents/
  SKILL.md            # lead reviewer process (lens-agnostic)
  references/
    plan-lens.md      # implementation-plan review lens
    spec-lens.md      # design-spec review lens
```

## Status

v0.1.0 ships the skill untested-by-pressure-scenario. Validation via crafted
fixture documents with planted defects (per the design spec's "Skill validation"
section) is deferred to a follow-up spec/plan and must land before the skill is
considered hardened.
