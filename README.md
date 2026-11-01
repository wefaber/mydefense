# MyDefense

Practice a project defense with your team. Pick a team, pick who you are, answer the questions you will be asked.
No account: progress stays in the browser. First team: Eternum (UTU, 4/11/26).

Part of [WeFaber](https://wefaber.net). Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md). Architecture:
[`ARCHITECTURE.md`](ARCHITECTURE.md). Design: [`DESIGN.md`](DESIGN.md).

## Run

```bash
bun install
bun run dev      # seeds Eternum, API on :5191, web on :5190
bun run check    # tsc + oxlint + oxfmt + repo checks + tests
```

Production: `bun run build && bun run db:seed && bun run start` (needs `MYDEFENSE_DB`, optional `MYDEFENSE_PORT`).
