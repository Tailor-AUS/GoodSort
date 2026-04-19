Onboard as Executor against the most recent handoff document.

## Steps

1. **Find the handoff**
   - Check `docs/` for the latest handoff file (typically `*-handoff.md`)
   - If multiple exist, ask which to execute against
   - Read the full handoff before responding

2. **Confirm understanding** — Respond with:
   - **Scope**: What's being asked
   - **What I can execute**: Concrete tasks I can complete as an AI agent (code changes, doc updates, research, drafting)
   - **What needs humans**: Legal, commercial, interpersonal, regulatory — flag these explicitly
   - **Open questions**: Anything ambiguous in the handoff that blocks execution
   - **Proposed order**: Sequence of AI-actionable tasks, shortest-first

3. **Wait for go-ahead**
   - Do NOT start executing until the user confirms the plan
   - Do NOT invent scope beyond the handoff
   - Do NOT touch anything flagged "needs humans" without explicit instruction

## Format

```
## Executor ready: <handoff title>

### Understood scope
<1-2 sentences>

### AI-actionable
- [ ] <task> — <file path if relevant>
- [ ] <task>

### Needs humans
- <task> — <why>

### Open questions
- <question>

### Proposed order
1. <first task>
2. <second task>

Ready to start? Let me know which task to pick up or if I've misread anything.
```
