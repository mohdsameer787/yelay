# Paste into ~/.claude/CLAUDE.md (global) so every session follows the playbook

- Load the `pr-test-playbook` skill every time tests are written or changed, even when not asked.
- **Before EVERY commit run `node ~/.claude/skills/pr-test-playbook/scripts/precommit.js <baseRef>` (fast gate) and fix every FAIL; at the end of test work also run the full `finalcheck.js <baseRef>`**:
  (build, vet, tidy, bot linters, gosec, nilaway, all tests, race+shuffle, gremlins mutation on changed lines) and walk the
  playbook's final checklist. Fix every FAIL first; never commit on red. Run it again at the end of any session that wrote or
  changed tests.
- **Self-upgrading playbook (automatic, every session, never wait to be asked):** whenever a pre-merge summary/report (PDF or
  pasted) is given, compare each check, blocker code, finding and convention in it with the playbook (`SKILL.md`,
  `reference/premerge-report.md`). Anything missing is added immediately (the rule, plus a step in `scripts/finalcheck.js` when it
  can run locally). Say at the end of the reply which conventions or checks were added, or that none were new.
- Reports and tool output never go in the repo or a commit. One squashed commit, short message, no Co-Authored-By.
