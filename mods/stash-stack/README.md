# stash-stack

`git stash` for your prompt. End a message with `/stash` to keep it on a stack instead of sending it:

```
refactor the auth middleware to use the new token cache /stash
```

`/stash pop` puts it back. Only the last word counts, so a message that mentions `/stash` is sent as written.

Turn on [`autoStash`](#settings) to also keep every draft you wipe without sending (Ctrl+U, select-all and delete, Ctrl+C). Short drafts (under 15 characters) and drafts you send are never kept that way.

A toast confirms each stash.

## Commands

| Command | Does |
| --- | --- |
| `/stash` or `/stash list` | Open the stack in a pane, with View (the whole draft), Pop and Drop per entry |
| `/stash pop [N]` | Put draft N (default 0, the newest) back in the prompt box and remove it from the stack |
| `/stash apply [N]` | Same, but keep it on the stack |
| `/stash drop [N]` | Delete draft N |
| `/stash clear` | Delete every stashed draft |

`N` can also be written `stash@{N}`.

## Install

```
/plugin install stash-stack --marketplace yyosifov/prompt-mods
```

## Settings

| Setting | Default | Does |
| --- | --- | --- |
| `autoStash` | off | Also stashes a draft you wipe without sending |
| `showStatus` | on | Shows `stash: N · /stash` in the status line while the stash holds anything |

To change one:

1. Run `/plugin` and pick **stash-stack** from your installed plugins.
2. Open its config.
3. Toggle **Stash wiped drafts** (`autoStash`) or **Show stash count** (`showStatus`).

The mod reloads with the new value at once; no restart is needed.

## Notes

- Stashes are kept per project (git root) and survive restarts, in `~/.claude/plugins/store/`.
- The stack keeps the 50 newest drafts; stashing the same text twice keeps one copy.
