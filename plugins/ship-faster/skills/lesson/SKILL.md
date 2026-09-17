---
name: lesson
description: Record a non-obvious cause, decision, or convention in the wiki the moment it is learned, as symptom, cause, rule, and evidence, plus a path-scoped rule when the lesson has a clear file scope.
when_to_use: Use right after fixing a bug whose cause was not visible in the code you edited, after choosing between approaches for a reason a reader could not infer from the code, or after discovering a constraint imposed by something outside the repository (a provider, an upstream interceptor, an environment). Also when the user says "remember this", "add a gotcha", or "write that down".
argument-hint: "[what was learned, in one sentence]"
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(node *), Bash(git *)
---

# Record a lesson

Repository facts:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" --brief --json || true`

Lesson given as argument (may be empty): $ARGUMENTS

From the facts: `<wikiDir>` = `config.wikiDir`, `<rulesDir>` = `config.rulesDir`, `<head>` = `git.head`, and `existing.wiki` says whether a wiki exists.

## 1. Draft the entry

Fill the template at `${CLAUDE_PLUGIN_ROOT}/templates/gotcha-entry.md` from the conversation or the argument:

- **Symptom**: what was observed, in the words a future reader would search for (the error message, the wrong value, the flaky behaviour).
- **Cause**: the part that was not visible in the code being edited: the upstream interceptor, the provider limit, the ordering constraint, the environment difference.
- **Rule**: one imperative sentence that prevents it next time.
- **Evidence**: `path:line` of the fix or of the constraint, or `<head>` shortened to 7 characters, and today's date.
- **Id**: `g-<yyyymmdd>-<slug>`, slug = 2 to 4 lowercase words joined by hyphens.

Delete the template's comment. Every line must be specific to this repository. A rule that would be true in any repository is not a lesson; say so and stop.

## 2. Classify

- **Gotcha** (default): a trap, a constraint, a cause that will bite again. Destination `<wikiDir>/gotchas.md`.
- **Decision**: a choice between approaches made for a reason a reader could not infer. Destination: the `## Decisions` section of `<wikiDir>/architecture.md`, in the form shown in `${CLAUDE_PLUGIN_ROOT}/templates/pages/architecture.md` (id `d-<yyyymmdd>-<slug>`; fields Decision, Why, Alternatives, Evidence).
- **Convention**: a pattern to follow or avoid from now on. Destination: `## Follow` or `## Avoid` in `<wikiDir>/conventions.md`, one bullet with an example path.

## 3. Show, then write

Print the entry and its destination, then write it. Do not wait for confirmation unless the user asked to review first.

- Destination page exists: append the entry at the end of the right section with one blank line before it. For every file cited in Evidence, add it to the page's `covers` list when no existing glob matches it (edit the frontmatter list in place, keeping the inline `[...]` form).
- `gotchas.md` missing: create it from `${CLAUDE_PLUGIN_ROOT}/templates/pages/gotchas.md`. `covers` = the files cited in Evidence. `verified` = `<head>`, or `unverified` when `git.isRepo` is false. `updated` = today. Replace every `{{placeholder}}` and delete the comment lines.
- No wiki at all (`existing.wiki` false): still create `<wikiDir>/gotchas.md` as above, run step 6, and say that `/ship-faster:onboard` builds the rest of the wiki.
- `architecture.md` or `conventions.md` missing for a decision or a convention: record it in `gotchas.md` instead and say so.

Then bump the page's `updated` date without touching `verified`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/page.mjs" touch <wikiDir>/<page>.md --json
```

## 4. Path-scoped rule

If the rule applies when editing particular files (Evidence names them, or the rule mentions a directory or a file kind), add one line to `<rulesDir>/<area>.md`. `<area>` is the top-level directory of the evidence path, or a short kebab-case name for the concern when the rule spans directories.

- File exists: append `- <Rule sentence> (<wikiDir>/gotchas.md <id>)`. Add a glob to `paths:` when no existing one matches the evidence file. Keep the file at 25 lines or fewer; when a line would exceed that, split the file by sub-directory into two files with narrower `paths`.
- File missing: create it from `${CLAUDE_PLUGIN_ROOT}/templates/rules-file.md` with `paths:` set to globs matching the evidence files (for example `["src/api/**"]`), the heading `# <Area> rules`, and this one rule line. Delete the template comment.

A rule with no file scope (a process rule, a habit) gets no rules file; it lives in the page only. When writing under `<rulesDir>` is denied (non-interactive runs deny it), print the rule line and the file it belongs in, and continue.

## 5. Budget

If `gotchas.md` now exceeds 200 lines, split it: move the entries of the largest area into `<wikiDir>/gotchas-<area>.md` (frontmatter copied, `title: Gotchas: <area>`, `covers` = the union of the moved entries' evidence files, `read_when` naming the area), keep the rest in `gotchas.md`, and update rules-file references that point at moved ids.

## 6. Index and lint

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/index.mjs" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --json
```

Fix every lint error (a `covers` glob matching no tracked file, a page over budget, a broken link, a credential-looking string) and run lint again until `errors` is empty.

## 7. Report

Three lines: the entry id and page; the rules-file line, or "no path scope"; the lint result.
