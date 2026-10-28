# Agent instructions

Read [CLAUDE.md](CLAUDE.md) (the rules) and [docs/GUIDE.md](docs/GUIDE.md) (background, file map, record format, how-tos) before making any change. They apply to every AI coding agent and to people.

The short version:
- Never rename or remove field keys or block ids in `js/schema.js` (to drop or move one, mark it `hide:true`), and run `node tools/update.js` after any change to it.
- Never edit a migration that is already on `main`; add a new, later-dated file instead.
- Never commit secrets or exported data. This repo is public.
- Run `node tools/check.js`, `bash test/run_sql_tests.sh <scratch-postgres-url>` and `node tools/smoke_test.js` before committing. CI runs the same checks and deploys nothing if they fail.
