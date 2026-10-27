# claith

Self-hosted agentic development environment that turns approved Delivery Contracts into evidence-backed software outcomes with minimal developer attention

## Development

This project uses TypeScript, Node.js 24, npm, ESLint, Prettier, and Vitest.
Activate the Node.js version in `.nvmrc`, then install dependencies and run the
application entry point:

```bash
npm ci
npm run dev
```

`src/main.ts` initializes the central configuration directory through
`src/bootstrap.ts`. The default path is `~/.claith`, defined in `src/settings.ts`.
Startup creates the `agents/`, `skills/`, and `sessions/` subdirectories, preserving
existing contents. It does not create files or a `databases/` directory. Startup
fails if a required directory cannot be created.

The delivery runtime and its integration with Temporal and Pi have not been
implemented yet.

- `npm run typecheck` checks source, tests, and the Vitest configuration.
- `npm run lint` checks code; `npm run format` formats files.
- `npm run format:check` checks formatting without changing files.
- `npm test -- tests/configuration.test.ts` checks directory creation and startup.
- `npm run build` compiles source into `dist/`; `npm start` runs the compiled app.

### Temporal development server

With Docker and Docker Compose installed, start the
[Temporal CLI development server](https://docs.temporal.io/cli/setup-cli):

```bash
docker compose up -d --wait
```

The Temporal API is available at `127.0.0.1:7233` and the Web UI at
<http://127.0.0.1:8233>. Both ports are bound to the local host only.
SQLite state is stored in the `temporal-data` Docker volume and survives
container recreation. Stop the service with `docker compose down`; add
`--volumes` only to intentionally delete the stored state.

This service is for local development.
