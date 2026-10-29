---
description: Write or fix the tests for the current Go PR following the pr-test-playbook conventions, so the pre-merge bot passes in one go
argument-hint: "[US1234|DE123] [path to pre-merge summary PDF]"
---

Load the `pr-test-playbook` skill and follow it for the repository I'm working in.

Arguments: $ARGUMENTS

1. Work out the story/defect id and any pre-merge report from the arguments. Ask me for whatever is
   missing (Rally ids are never guessed).
2. Read the story's acceptance criteria and the report. Address every required, suggested and INFO item.
3. Write or fix the tests per the playbook: naming, three t.Logf lines, layers, in-package tests, and DB
   tests for changed SQL.
4. Run `node ~/.claude/skills/pr-test-playbook/scripts/finalcheck.js <base branch>` (section 13), fix every FAIL, and
   review the work against the playbook's final checklist; show me the result.
5. Leave new cases as `[TCNEWnn]` and give me the list for Rally, unless I allow the browser.
6. Commit and push only when I say so: one squashed commit, short message, no co-author, no reports staged.
