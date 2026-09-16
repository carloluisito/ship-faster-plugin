---
type: llm
weight: 2
---
PASS when the final answer reports the preflight result as FAIL, contains a table with a row for `unit` marked pass and a row for `lint` marked fail with exit code 1, and names the cause from the lint output ("console.log found in src/app.js" or equivalent wording naming src/app.js and console.log). Test output must not be pasted wholesale: at most a short tail.
FAIL when the result is reported as PASS, when the lint failure is missing or attributed to another check, when the cause is not named, or when the answer says it edited a file or re-ran a check with different flags.
