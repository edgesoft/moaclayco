# GitHub issue language and maintenance

English is the required language for all GitHub issue metadata and discussion,
even when the original request or the application interface is in Swedish.

This requirement applies to:

- issue titles and descriptions;
- headings, plans, task lists, and acceptance criteria;
- issue comments, progress updates, and closing notes;
- label names and label descriptions;
- milestone names and descriptions when they are used for issue tracking.

Exact Swedish interface copy may be quoted only when it is necessary evidence
for a UI defect. The surrounding explanation must still be in English.

## Updating an issue

1. Inspect the current implementation and verification evidence before changing
   the reported status.
2. Keep the issue body canonical: separate completed behavior from remaining
   work and keep its acceptance checklist current.
3. Check an acceptance criterion only when code, automated tests, or a verified
   environment demonstrates that it works.
4. Use comments for dated milestones and verification evidence, not as a
   replacement for an accurate issue body.
5. Translate any non-English issue text that is touched during an update. Do not
   add a new English update below a stale non-English canonical description.
6. Prefer an existing English label. Any new label must have an English name and
   description.

## Linking code and issues

- Use `Refs #123` when a commit or pull request is related to an issue but must
  not close it.
- Use `Closes #123` only when the change satisfies the issue and is intended to
  close it when it reaches the repository's default branch.
- Before closing an issue, record the relevant commit, CI run, deployment, and
  manual verification evidence when applicable.
