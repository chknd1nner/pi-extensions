# tmux Quick Start Guide

## What is tmux?
**tmux** is a terminal multiplexer – it lets you run multiple terminal sessions in a single window and keep them running even if you disconnect.

---

## Installation (macOS)
Already installed via Homebrew:
```
brew install tmux
```
Verify:
```
tmux -V
```

---

## Getting Started
### Start a new session
```
tmux
```

### Detach from a session (keep it running)
Press:
```
Ctrl-b d
```

### List sessions
```
tmux ls
```

### Re-attach to a session
```
tmux attach
```

---

## Windows and Panes
- **New window:** `Ctrl-b c`
- **List windows:** `Ctrl-b w`
- **Switch window:** `Ctrl-b n` (next), `Ctrl-b p` (previous)
- **Split pane (vertical):** `Ctrl-b %`
- **Split pane (horizontal):** `Ctrl-b "`
- **Switch panes:** `Ctrl-b o`

---

## Exiting & Killing
- **Kill a window:** `Ctrl-b &`
- **Kill a pane:** type `exit` in the pane or `Ctrl-b x`
- **Kill a session:** `tmux kill-session -t <session-name>`

---

## Helpful Commands
- **Rename session:** `Ctrl-b $`
- **Rename window:** `Ctrl-b ,`
- **Scrollback:** `Ctrl-b [`
    - Move with arrow keys, PgUp/PgDn; exit copy mode with `q`

---

## Further Reading
- [tmux Cheat Sheet](https://tmuxcheatsheet.com/)
- [tmux Man Page](https://man7.org/linux/man-pages/man1/tmux.1.html)
- [Official GitHub](https://github.com/tmux/tmux)

---

**Pro tip:** All commands are started with `Ctrl-b` (hold Control, press `b`), then another key.
