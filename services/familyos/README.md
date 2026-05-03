# FamilyOS Service

A Telegram-first AI assistant for the whole family, built on the [Pi SDK](https://www.npmjs.com/package/@mariozechner/pi-coding-agent). FamilyOS gives family members a consumer-style chat experience while preserving Pi's powerful session management for power users.

**What it does:**
- Single Telegram bot serving multiple registered family members
- Each user gets isolated sessions, workspaces, and conversation history
- Default assistant persona with optional agent switching
- Secure file tools with sandboxed access (no bash in MVP)
- Full Pi session semantics: branching, compaction, model switching

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setting Up a Telegram Bot](#setting-up-a-telegram-bot)
3. [Quick Start on a New Mac](#quick-start-on-a-new-mac)
4. [Provider Authentication](#provider-authentication)
5. [Registering Users](#registering-users)
6. [Telegram Commands](#telegram-commands)
7. [Project Structure](#project-structure)
8. [Agents](#agents)
9. [Configuration](#configuration)
10. [Verification](#verification)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before setting up FamilyOS on your Mac "server":

| Requirement | Version | Notes |
|-------------|---------|-------|
| macOS | 12+ | Intel or Apple Silicon |
| Node.js | 22+ | Check with `node --version` |
| npm | 10+ | Comes with Node.js |
| Git | Any recent | For cloning the repository |

### Installing Node.js

If you don't have Node.js 22+:

```bash
# Using Homebrew (recommended)
brew install node@22

# Or download from https://nodejs.org
```

---

## Setting Up a Telegram Bot

FamilyOS requires a Telegram bot. Create one via BotFather:

### Step 1: Create the Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g., "FamilyOS Assistant")
4. Choose a username ending in `bot` (e.g., `myfamilyos_bot`)
5. BotFather replies with your **bot token** — save this securely

The token looks like: `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`

### Step 2: Configure Bot Settings (Optional)

While in BotFather:

```
/setdescription   → "AI assistant for the family"
/setabouttext     → "Built on Pi"
/setuserpic       → Upload an avatar
/setcommands      → See command list below
```

For `/setcommands`, paste:
```
whoami - Show your Telegram ID and FamilyOS identity
new - Start a fresh conversation
resume - Continue a previous conversation
tree - Navigate conversation branches
compact - Compress conversation history
model - Switch AI models
agent - Switch assistant persona
cancel - Stop the current response
```

### Step 3: Note Your Bot Token

You'll need this token to start FamilyOS. Keep it secret — anyone with this token can control your bot.

---

## Quick Start on a New Mac

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd pi-extensions
```

### 2. Install Dependencies

```bash
cd services/familyos
npm install
```

### 3. Set the Bot Token

Create a `.env` file or export directly:

```bash
# Option A: Environment variable
export TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"

# Option B: Create .env file (not committed to git)
echo 'TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' > .env
```

### 4. Authenticate with AI Providers

FamilyOS uses the Pi SDK which stores credentials in a shared directory. **Before starting FamilyOS**, authenticate with your preferred providers.

The simplest approach: install Pi CLI and use its login flow:

```bash
# Install Pi globally
npm install -g @mariozechner/pi-coding-agent

# Run Pi once to trigger authentication
pi
```

Once Pi is running:

```
/login anthropic    → Authenticate with Anthropic (Claude)
/login openai       → Authenticate with OpenAI
/login google       → Authenticate with Google (Gemini)
/quit               → Exit Pi
```

Alternatively, set environment variables (they'll be picked up automatically):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export GOOGLE_API_KEY="..."
```

**How authentication flows to FamilyOS:**

Pi stores credentials in `~/.pi/agent/auth.json`. FamilyOS overrides this location to use a shared directory (`.familyos-pi/` in the repository root) so all family members share the same provider access. When FamilyOS starts, it reads from this shared auth storage, and any provider authenticated via Pi's `/login` command becomes available.

### 5. Start FamilyOS

```bash
npm start
```

You should see:
```
FamilyOS Telegram adapter started
```

### 6. Test the Bot

Open Telegram, find your bot, and send:

```
/whoami
```

The bot responds with your Telegram numeric ID:
```
Telegram ID: 123456789
```

You're not registered yet, so other commands will prompt you to contact the admin.

---

## Provider Authentication

### Authentication Methods

FamilyOS supports multiple authentication approaches, checked in this order:

1. **Runtime overrides** — Set programmatically (not typical for FamilyOS)
2. **Stored credentials** — In `.familyos-pi/auth.json` (via Pi `/login`)
3. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.

### Using Pi's Login Flow (Recommended)

The Pi CLI provides interactive authentication:

```bash
# If Pi isn't installed
npm install -g @mariozechner/pi-coding-agent

# Start Pi from the repository root
cd /path/to/pi-extensions
pi

# Inside Pi, authenticate providers
/login anthropic
/login openai
/login google
```

After `/login`, Pi opens your browser for OAuth or prompts for an API key. Credentials are stored and persist across restarts.

### Using Environment Variables

For deployment or scripts, set environment variables:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export OPENAI_API_KEY="sk-proj-..."
export GOOGLE_API_KEY="AIza..."
```

### Checking Available Models

Once authenticated, FamilyOS only exposes models from providers that have valid credentials. Start the service and use `/model` to see what's available.

---

## Registering Users

FamilyOS requires manual user registration. This is intentional for MVP — the admin controls who can use the bot.

### Step 1: Get the User's Telegram ID

Have the person message your bot:
```
/whoami
```

The bot replies:
```
Telegram ID: 987654321
```

### Step 2: Create the User Manifest

Create `users/<slug>/user.json` in the repository root:

```bash
mkdir -p users/alice
```

```json
{
  "id": "alice",
  "displayName": "Alice",
  "channels": {
    "telegram": {
      "userIds": ["987654321"]
    }
  }
}
```

**Rules:**
- `id` must match the directory name
- `displayName` is for friendly references
- `userIds` is an array (one person can have multiple Telegram accounts)

### Step 3: Verify Registration

Have the user send `/whoami` again:

```
Telegram ID: 987654321
FamilyOS user: alice
```

Now they can use all bot features!

### Home Directory Scaffolding

On first successful use, FamilyOS automatically creates:

```
users/alice/
├── user.json          # Created by admin
├── state.json         # Active session + agent (auto-created)
└── home/
    ├── Inbox/         # For uploaded files
    ├── Workspace/     # Working directory
    ├── Exports/       # Output files
    ├── .familyos/
    │   └── settings.json
    └── .pi/
        └── settings.json
```

---

## Telegram Commands

### For Everyone

| Command | Description |
|---------|-------------|
| `/whoami` | Show your Telegram ID and FamilyOS identity |

### For Registered Users

| Command | Description |
|---------|-------------|
| `/new` | Start a fresh conversation (doesn't delete Telegram history) |
| `/resume` | Continue a previous conversation from a list |
| `/tree` | Navigate conversation branches with filters |
| `/compact` | Compress conversation to reduce context/cost |
| `/model` | Switch AI models (shows cost warning) |
| `/agent` | Switch assistant persona |
| `/cancel` | Stop the current AI response |

### Command Details

#### `/new`
Creates a fresh Pi session. Your Telegram chat history stays intact — only the AI's memory resets.

#### `/resume`
Shows a paginated list of previous sessions. Select one to continue where you left off.

#### `/tree`
Displays your conversation as an ASCII tree. Filters available:
- **All** — Every message
- **No-tools** — Messages without tool calls
- **User-only** — Just your messages
- **Labeled** — Messages you've bookmarked

Select a node to:
- **Restore full context** — Jump to that point
- **Branch with summary** — Create a new branch with context summary

#### `/compact`
Summarizes earlier conversation to reduce tokens. Options:
- **Compact now** — Use default summarization
- **Compact with custom instruction** — Provide summarization guidance

#### `/model`
Switch between available AI models. Always warns about cache reset and potential cost increase. Options after selecting a model:
- **Switch anyway** — Change model in current session
- **Branch + compact, then switch** — Summarize first
- **New session** — Fresh start with new model

#### `/agent`
Switch between assistant personas. Options:
- **Continue current session** — Keep history, inject handoff context
- **Start fresh session** — New conversation with new persona
- **Branch with summary, then switch** — Summarize first

---

## Project Structure

```
pi-extensions/                    # Repository root (FamilyOS root)
├── agents/                       # Shared agent definitions
│   └── default/
│       ├── SOUL.md              # Persona/system prompt
│       └── agent.json           # Capabilities config
├── config/
│   └── familyos.json            # Root FamilyOS configuration
├── logs/
│   └── audit.jsonl              # Security/activity audit log
├── users/
│   └── <slug>/                  # Per-user directory
│       ├── user.json            # Identity + channel mappings
│       ├── state.json           # Active session + agent
│       └── home/                # User workspace (Pi cwd)
│           ├── Inbox/
│           ├── Workspace/
│           ├── Exports/
│           ├── .familyos/
│           │   └── settings.json
│           └── .pi/
│               └── settings.json
├── .familyos-pi/                # Shared Pi data
│   ├── auth.json                # Provider credentials
│   ├── settings.json            # Global Pi settings
│   └── sessions/                # Pi session files
└── services/
    └── familyos/                # This service
        ├── src/
        ├── package.json
        └── README.md
```

### Key Directories

| Path | Purpose |
|------|---------|
| `agents/` | Shared agent bundles available to all users |
| `config/familyos.json` | Root config (default agent, Telegram settings) |
| `users/<slug>/home/` | Each user's sandboxed workspace |
| `.familyos-pi/` | Shared Pi authentication and sessions |
| `logs/audit.jsonl` | Security audit trail |

---

## Agents

Agents define assistant personas with specific capabilities.

### Agent Bundle Structure

```
agents/<agent-id>/
├── SOUL.md        # System prompt / persona
└── agent.json     # Capabilities
```

### Example agent.json

```json
{
  "id": "default",
  "displayName": "FamilyOS Assistant",
  "capabilities": {
    "tools": ["read", "grep", "find", "ls"],
    "readRoots": ["Inbox", "Workspace", "Exports"],
    "writeRoots": ["Workspace", "Exports"]
  }
}
```

### Available Tools (MVP)

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `grep` | Search file contents |
| `find` | Find files by pattern |
| `ls` | List directory contents |
| `write` | Create/overwrite files |
| `edit` | Edit existing files |

**Note:** `bash` is explicitly excluded from MVP for security.

### Tool Sandboxing

Tools are constrained to allowed roots:
- `readRoots` — Directories the agent can read from
- `writeRoots` — Directories the agent can write to

Paths are relative to `users/<slug>/home/`. Agents cannot access:
- `.pi/` or `.familyos/` config directories
- Other users' home directories
- System files outside allowed roots

### User-Local Agents

Users can override or add agents in their home:

```
users/alice/home/.familyos/agents/custom/
├── SOUL.md
└── agent.json
```

User-local agents replace same-named root agents.

---

## Configuration

### Root Config (config/familyos.json)

```json
{
  "defaultAgentId": "default",
  "sharedPiAgentDir": ".familyos-pi",
  "telegram": {
    "flowTtlSeconds": 900,
    "typingIntervalMs": 4000,
    "pageSize": 8
  }
}
```

| Key | Description |
|-----|-------------|
| `defaultAgentId` | Agent used when users don't explicitly switch |
| `sharedPiAgentDir` | Shared Pi data directory (relative to repo root) |
| `telegram.flowTtlSeconds` | How long interactive menus stay valid |
| `telegram.typingIntervalMs` | Typing indicator refresh rate |
| `telegram.pageSize` | Items per page in paginated lists |

### User Settings Merge

Settings are composed from multiple layers:
1. Global: `.familyos-pi/settings.json`
2. User-local Pi: `users/<slug>/home/.pi/settings.json`
3. User-local FamilyOS: `users/<slug>/home/.familyos/settings.json`

Later layers override earlier ones. Keys merge recursively.

---

## Verification

### Run Tests

```bash
cd services/familyos
npm run test
```

### Type Check

```bash
npm run typecheck
```

### Manual Testing Checklist

- [ ] `/whoami` works for unregistered users
- [ ] Registered user can chat normally
- [ ] `/new` creates fresh session
- [ ] `/resume` shows session list
- [ ] `/tree` displays conversation branches
- [ ] `/model` shows available models
- [ ] `/cancel` stops active response
- [ ] File uploads persist to `home/Inbox/`
- [ ] Long messages split cleanly

---

## Troubleshooting

### "TELEGRAM_BOT_TOKEN is required"

Set the environment variable:
```bash
export TELEGRAM_BOT_TOKEN="your-token-here"
```

### "No models available"

You haven't authenticated with any AI provider. Either:
1. Run `pi` and use `/login anthropic` (or other provider)
2. Set `ANTHROPIC_API_KEY` or similar environment variable

### "You're not registered with FamilyOS yet"

Create a user manifest:
```bash
mkdir -p users/yourname
echo '{"id":"yourname","displayName":"Your Name","channels":{"telegram":{"userIds":["YOUR_TELEGRAM_ID"]}}}' > users/yourname/user.json
```

### Bot doesn't respond

1. Check the service is running (`npm start`)
2. Verify you're in a private chat (groups are ignored in MVP)
3. Check the console for errors

### "That menu has expired"

Interactive menus expire after ~15 minutes. Run the command again.

### Agent can't access files

Check `agent.json` capabilities:
- Is the tool in the `tools` array?
- Is the directory in `readRoots` or `writeRoots`?

### Session state seems corrupted

Delete the user's state file to reset:
```bash
rm users/<slug>/state.json
```

FamilyOS will create a fresh session on next message.

---

## Security Notes

- **No bash in MVP** — Agents cannot execute arbitrary commands
- **Sandboxed file access** — Tools enforce path restrictions
- **Audit logging** — All significant actions logged to `logs/audit.jsonl`
- **Manual registration** — No self-signup; admin controls access
- **Secrets isolation** — Bot token and credentials outside agent-accessible paths

---

## License

See repository root for license information.
