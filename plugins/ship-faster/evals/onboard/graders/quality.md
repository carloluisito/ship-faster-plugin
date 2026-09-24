---
type: llm
weight: 3
focus: { source: file, path: CLAUDE.md }
---
PASS when all of the following hold for CLAUDE.md:
- It is under 150 lines and has a managed block between the ship-faster marker comments with these sections in order: What this is, Stack, Layout, Commands, Read next, Workflow.
- The Commands table lists `npm test` and `npm run lint` with a duration, and does not list `npm start` as a verified command (it is a server; it may appear as "not run").
- The Layout section names `src/routes`, `src/lib`, and `tests` with what each owns, without a file tree.
- The Read next table points at paths under docs/wiki/ and includes at least one recipe for the users endpoints.
- No wiki page is imported with an @ prefix.
FAIL when any section is missing, when a command that was not run is presented as verified, or when the file exceeds 150 lines.
