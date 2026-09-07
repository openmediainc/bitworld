# AGENTS.md

This is District, a TypeScript monorepo (npm workspaces).

- Keep world physics in apps/hub. Keep rendering in apps/web.
- Shared types live in packages/shared. Do not drift interfaces.
- Do not add a database.
- Do not fake tool activity for non-simulated agents.
- Pixel art is generated in code; do not add large binary assets.
- Prefer small files and explicit types.
- After changes, run npm run typecheck and npm run test.
