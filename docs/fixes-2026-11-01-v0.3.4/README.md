# Fixes 2026-11-01 · v0.3.4

## Grading

- [~] Grader too strict on specifics and institutional context (prompt rewritten in `server/ai/grading.ts`: level calibration, essential ideas only in `missing`, vocabulary slips cost only terminology, `unsupported` only for wrong claims). Tested on the prompt text; needs a real run against the CI/CD example with the model.

## Correction view

- [~] The student cannot see their own answer in the correction: `Grading.answer` returned and shown in the panel (quiz and mock defense). UI not checked in the browser (needs a model key).
- [~] The student cannot justify or comment: "No coincido: justificar" re-grades with a comment (`note`, 600 chars, fenced as data). UI not checked in the browser.
