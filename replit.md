# Spence Contracting – Project Manager

## Overview
A single-page web application for tracking construction and renovation projects for Spence Contracting. Built with pure vanilla HTML, CSS, and JavaScript — no build tools or external dependencies required.

## Project Structure
- `public/index.html` — The entire application (HTML, CSS, JavaScript in one file), pulled and patched from GitHub
- `server.js` — Express server that serves `public/` and proxies Anthropic API requests via `/api/estimate`
- `package.json` — Node.js dependencies (express, cors)

## Running the App
```
node server.js
```
Server runs on port 5000. Workflow: "Start application".

## Tech Stack
- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6) — no frameworks
- **Backend:** Node.js + Express
- **Database:** Firebase Firestore (live sync, credentials embedded in index.html)
- **AI:** Anthropic Claude (`claude-sonnet-4-6`) via server-side proxy

## Features
- Project dashboard with stats (jobs, active, budget, spent)
- Search and filter projects by status
- Estimate management with AI-powered line item generation
- Firebase live sync
- AI assistant for estimates (add/remove/update items, generate exclusions)

## GitHub Source
- URL: `https://raw.githubusercontent.com/phillips434/Spence-contracting/main/Index.html`
- Pulled and patched with `patch.js` then deleted

## Patch Workflow (Standard)
1. Write `patch.js`
2. `node patch.js && rm patch.js`
3. Restart workflow
4. Screenshot to verify
5. `suggest_deploy`

## Patches Applied on Every Pull
1. Curly double quotes → straight quotes
2. API URL → `/api/estimate`
3. Strip `x-api-key` headers → `Content-Type` only
4. Model → `claude-sonnet-4-6` (use broad regex `/claude-(?:opus|sonnet|haiku)-[0-9][0-9a-z-]*/g` to catch all naming variants e.g. `claude-haiku-4-5-20251001`, `claude-sonnet-4-20250514`)
5. `max_tokens:(1000|1500|2000)` → `max_tokens:4000` (generateAIEstimate needs ≥4000 for complex estimates; keep max_tokens:20 ping and max_tokens:200 log calls unchanged)
6. JS Bug #1: `(''+var+'')` → escaped single quotes
7. JS Bug #2: unescaped `fn('literal')` inside `html+=` lines
8. JS Bug #3: missing `}` closing the `else` block in `renderEstDetailBody`

## Secrets
- `ANTHROPIC_KEY` — Anthropic API key (server-side only, never exposed to client)
