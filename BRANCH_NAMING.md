# Branch naming

Branch names must never start with `agent/` or `codex/`.

- Do not create, rename, publish, or continue work on a branch that uses either
  tool prefix.
- Use a short, neutral, descriptive branch name.
- If an existing branch starts with a forbidden prefix, rename it before the
  next commit or push.
- Verify the active branch with `git branch --show-current` before committing.

Example:

```sh
git branch -m mobile-context-panel
```
