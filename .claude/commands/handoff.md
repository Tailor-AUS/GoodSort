Create a handoff document for another developer or Claude session to pick up work. Argument: brief description of the task.

## Steps

1. **Capture current state**
   - `git status` — uncommitted changes
   - `git log --oneline -10` — recent commits
   - `git branch --show-current` — current branch
   - `git diff --stat origin/main` — what's changed vs main

2. **Write the handoff** — Output a summary covering:
   - **Context**: What problem is being solved and why
   - **What's done**: Commits made, files changed, what was tested
   - **What's left**: Remaining work, known issues, blockers
   - **Key files**: Exact paths and line numbers for the relevant code
   - **How to test**: Steps to verify the changes work
   - **Gotchas**: Anything non-obvious (auth quirks, CSP, deploy triggers)

3. **Ensure branch is pushed**
   - Commit any uncommitted work
   - `git push -u origin <branch>`

## Handoff format
```
## Handoff: <title>
**Branch:** `<branch-name>`
**Status:** <in-progress|ready-for-review|blocked>

### Context
<1-2 sentences on what and why>

### Done
- <commit hash> <description>
- <commit hash> <description>

### Remaining
- [ ] <task>
- [ ] <task>

### Key files
- `path/to/file.tsx:42` — <what's there>

### Testing
1. <step>
2. <step>

### Gotchas
- <non-obvious thing>
```
