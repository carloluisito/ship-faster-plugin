---
type: llm
weight: 2
---
PASS when the final answer lists at least one finding coded R1 (or similar) with severity block or warn, located at src/api.js on the line that adds console.log, quoting the repository's rule about console.log verbatim or nearly verbatim from docs/wiki/gotchas.md or docs/wiki/conventions.md (mentioning log() from src/lib/log.js or the request id), naming the page it came from, and giving a fix that replaces console.log with the log() helper.
FAIL when no finding is reported, when the finding is generic advice without a quoted repository rule, when the file or line is wrong, or when the answer says it edited a file.
