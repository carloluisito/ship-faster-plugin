# Analyst areas

Launch one `ship-faster:repo-analyst` per row. Each prompt is `area: <name>`, `brief: <text>`, `detect: <json>`, `footprints: <json>`.

| Area | Brief | Feeds |
|---|---|---|
| stack-and-commands | Languages and versions, frameworks, package manager, every script or task-runner target with what it does, env vars by name, ports, tool versions pinned in files (.nvmrc, global.json, .tool-versions). Say which commands are long-running (servers, watchers). | overview (Stack), commands |
| layout-and-entry-points | What each top-level directory owns, the process entry points and what starts them, where a new file of each kind goes and how it is named, generated outputs that must not be edited. | layout, CLAUDE.md Layout |
| tests | Test frameworks, where each kind of test lives, how one test is run alone, fixtures and factories, mocks and fakes, coverage config, tests that need services or credentials. | testing |
| conventions | Naming (files, exports, types, tests), module boundaries, error handling, logging, lint and format config and what it enforces, patterns repeated across the codebase, patterns explicitly avoided (comments, lint rules, ADRs). | conventions, rules files |
| architecture-and-data-flow | Components and what each owns, how a request or job moves through them, persistence and external systems, boundaries (what may call what), decisions recorded in ADRs, comments, or commit messages with their reasons. | architecture, overview (Boundaries) |
| ops-and-ci | CI workflows and what each job gates, environments, how deploys happen (never run them), release and versioning process, tag format, secret names (never values), monitoring. | ops, commands (Checks) |
| dependencies | Key runtime and dev dependencies with why each is there, pinned versions with a visible reason, lockfile, upgrade tooling, private registries. | dependencies |

Large repositories (`git.sizeClass` `large`): one extra `architecture-and-data-flow` analyst per top-level directory with more than 50 files, brief "architecture and data flow of <dir> only".

When two analysts disagree, keep the fact with the higher confidence and the more specific evidence, and put the other in the report's open questions.
