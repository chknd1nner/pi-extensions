# pi-skills

A collection of standalone π skills that are useful on their own but don't each
warrant a dedicated package or mirror repo. Install the bundle once; every skill
inside becomes available.

## Skills

### reviewing-large-documents

A hierarchical review workflow for specs and implementation plans too large (~4k+
lines) to read whole while preserving reviewer judgment.

A lead reviewer works from `mdedit` outlines and preamble sections only, delegates
deep review of batched sections to isolated workers with a frozen shared context
pack, cross-checks the workers' contract ledgers for cross-boundary defects, and
dispatches bounded targeted probes before writing a severity-tiered review.

- Requires [`mdedit`](https://crates.io/crates/mdedit) on PATH (structured markdown
  outline/extract; the skill fails closed without it).
- Requires the `delegate` extension (`delegate_pack`, `delegate_start`) from
  [pi-delegate-driven-development](https://github.com/chknd1nner/pi-delegate-driven-development).
- Design spec: `docs/superpowers/specs/2026-07-11-reviewing-large-documents-skill-design.md`
  in the originating `pi-extensions` monorepo.
- Status: v0.1.0 ships untested-by-pressure-scenario. Validation via crafted
  fixture documents with planted defects (per the design spec's "Skill validation"
  section) is deferred to a follow-up spec/plan and must land before the skill is
  considered hardened.

## Install

Add to a project's `.pi/settings.json`:

```json
{
  "packages": [
    "git:github.com/chknd1nner/pi-delegate-driven-development@v0.3.0",
    "git:github.com/chknd1nner/pi-skills@v0.1.0"
  ]
}
```

(The `pi-delegate-driven-development` entry is only needed by skills that delegate
to workers, such as `reviewing-large-documents`.)

## Layout

```
skills/
  reviewing-large-documents/
    SKILL.md            # lead reviewer process (lens-agnostic)
    references/
      plan-lens.md      # implementation-plan review lens
      spec-lens.md      # design-spec review lens
```
