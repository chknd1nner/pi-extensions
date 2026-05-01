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
