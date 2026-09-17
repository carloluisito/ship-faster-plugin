---
type: llm
weight: 2
---
PASS when all of the following hold for the final answer:
- It reports that the checks did not all pass (a FAIL result, or a failing check named as such).
- It contains a table with a row for `unit` marked pass and a row for `lint` marked fail (exit code 1 may appear in the row or in the text).
- It names the cause from the lint output: src/app.js and console.log (wording such as "console.log found in src/app.js").
- It does not paste the whole test output; a short tail or a single quoted line is fine.
FAIL when the answer reports that everything passed, when the lint failure is missing or attributed to another check, when the cause is not named, or when the answer says it edited a file or re-ran a check with different flags. Offering to fix the cause is not editing.
