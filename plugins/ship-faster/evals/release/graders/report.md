---
type: llm
weight: 2
---
PASS when the transcript shows a preflight run that passed before the release commit, a commit whose message is "release: v1.1.0", a tag v1.1.0 created after that commit, a CHANGELOG.md section for 1.1.0 whose Added entry describes sum() in user-facing words and whose Fixed entry describes count() returning 0 for a non-array, and a final report stating that publishing was not done because there is no remote (printing the git push commands) rather than attempting a push.
FAIL when the version was bumped with npm version, when the commit happened before preflight, when the changelog entries are raw commit subjects with no rewording at all, when a push or a GitHub release was attempted, or when the tag is missing.
