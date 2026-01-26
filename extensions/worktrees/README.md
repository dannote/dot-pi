# Git Worktrees Extension

Manage git worktrees for isolated parallel agent workspaces.

## Features

- **Create/remove worktrees** via tools the LLM can call
- **Auto-detect project setup** (bun, npm, pnpm, yarn, cargo, go, pip)
- **Status widget** showing active worktrees in the UI
- **System prompt injection** teaching the LLM when/how to use worktrees

## Installation

```bash
# Symlink to extensions directory
mkdir -p ~/.pi/agent/extensions/worktrees
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/worktrees/index.ts" \
  ~/.pi/agent/extensions/worktrees/index.ts
```

Or copy the file directly.

## Tools

| Tool | Description |
|------|-------------|
| `worktree_create` | Create isolated worktree with new branch |
| `worktree_list` | List all worktrees in repository |
| `worktree_status` | Get git status of a specific worktree |
| `worktree_remove` | Remove worktree (branch preserved) |

## Usage with Subagent

The main use case is running parallel subagents in isolated workspaces:

```
User: "Fix the auth tests and add caching, work in parallel"

LLM:
1. worktree_create(name: "fix-auth")
2. worktree_create(name: "add-caching")
3. subagent(tasks: [
     { agent: "worker", task: "Fix auth tests", cwd: ".worktrees/fix-auth" },
     { agent: "worker", task: "Add caching", cwd: ".worktrees/add-caching" }
   ])
4. Review with worktree_status
5. Merge: git merge fix-auth && git merge add-caching
6. Cleanup: worktree_remove("fix-auth"), worktree_remove("add-caching")
```

## UI

**Footer status**: Shows `⎇ N worktrees` when worktrees are active

**Widget**: Displays list of active worktrees above the editor:
```
─── Worktrees ───
● fix-auth /project/.worktrees/fix-auth
○ add-caching /project/.worktrees/add-caching
```
- `●` = setup completed
- `○` = setup in progress

## How It Works

1. **Creates worktrees** in `.worktrees/` directory (auto-added to .gitignore)
2. **Each worktree** gets its own branch based on current HEAD (or specified base)
3. **Project setup** runs automatically (detects lock files)
4. **Branches persist** after worktree removal for merging

## Commands

| Command | Description |
|---------|-------------|
| `/worktree` | Interactive worktree selector with type-to-filter and actions (show path, status, remove) |
| `/worktrees` | List all worktrees (quick notification) |

## What's a Git Worktree?

A worktree is a linked working directory sharing the same `.git` but with a different branch checked out. Unlike `git checkout`, multiple worktrees can exist simultaneously.

```
my-project/                    # Main (e.g., main branch)
├── .git/
└── src/

my-project/.worktrees/
├── fix-auth/                  # Worktree (fix-auth branch)
│   └── src/
└── add-caching/               # Worktree (add-caching branch)
    └── src/
```

This enables true parallel work without branch switching or stashing.
