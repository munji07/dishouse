# DISHOUSE — Agent Guide

- Next.js 16 (App Router, `src/`), Tailwind 4, TypeScript
- DB: Supabase Postgres via `pg` (`DATABASE_URL` pooler, ssl rejectUnauthorized false, strip sslmode param) — table `rooms` (id/name/channel_id)
- Auth: Discord OAuth2 (`/api/auth/login` → `/api/auth/callback`), session cookie `dishouse_session` (base64url JSON, httpOnly)
- Discord: `DISCORD_CLIENT_ID=1525466279635325079` (support-bot, OAuth), `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET`, `NEXT_PUBLIC_SITE_URL=https://dishouse.p-e.kr` (뒤 슬래시 없음, Discord Redirects에 `/api/auth/callback` 정확히 등록 필요)
- 2D: `src/components/HouseCanvas.tsx` — Canvas, 6 rooms rect map, WASD/arrow move, mobile pad
- Scripts: `npm run migrate` seeds rooms

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
