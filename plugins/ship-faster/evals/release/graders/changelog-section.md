---
type: regex
pattern: '## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}[\s\S]*### Added[\s\S]*### Fixed'
target: { source: file, path: CHANGELOG.md }
---
