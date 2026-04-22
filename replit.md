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

## Patches Applied on Every Pull (in order)
1. **Curly quotes → straight** — `\u201C/D` → `"`, `\u2018/9` → `'`
2. **DEBUG section replacement** — The developer frequently pushes a DEBUG fetch block (`// DEBUG: Use identical fetch to test button...`) with `max_tokens:100`, alert popups, orphaned `.finally()`. Replace the ENTIRE section from `// DEBUG:` through the orphaned `.finally()'s });` (which is immediately before the function's closing `}`) with the proper 4000-token fetch that includes the system prompt `sp`. Regex: `/\/\/ DEBUG: Use identical fetch to test button to isolate issue\n[\s\S]*?  \}\);\n(?=\})/`
3. **API URLs → `/api/estimate`** — Replace both `https://api.anthropic.com/v1/messages` AND `https://spence-contracting--phillip95.replit.app/api/estimate`
4. **Strip `x-api-key` headers** — Remove `'x-api-key'` and `'anthropic-version'` header lines
5. **Model → `claude-sonnet-4-6`** — Broad regex `/claude-(?:opus|sonnet|haiku)-[0-9][0-9a-z-]*/g`
6. **max_tokens 100/1000/1500/2000 → 4000** — Keep `max_tokens:20` ping and `max_tokens:200` log unchanged
7. **JS Bug #3: missing `}` for else block in `renderEstDetailBody`** — The `else` block for line items (`} else { var byCategory={}; ... forEach ... html+='</div>';`) never gets its closing `}`. Add `  }` after the `html+='</div>';` line that follows the forEach closings, and before `// ── PAYMENT SCHEDULE ──`. Regex: `/(    html\+='<\/div>';\n)\n(  \/\/ ── PAYMENT SCHEDULE)/` → `"$1  }\n\n$2"`
8. **JS Bug #1: `fn(''+var+'')` → escaped quotes** — General regex: `(\w+)\(''\+([^+)]+)\+''\)` → `$1(\\''+$2+'\\')`. Fixes `submitSignature(''+e.id+'')`, `openDetail(''+p.id+'')` etc. inside single-quoted `html+=` strings.
9. **JS Bug #2: `fn('LITERAL')` in event handler attrs** — Only escape literal string args (no `+` in content) inside `on<event>="..."` attributes. Regex: `/(on\w+="[^"]*\w+)\('([^'+\\]*)'\)/g` → `$1(\\'$2\\')`. DO NOT match variable patterns like `fn('+xi+')` which need `+` excluded via `[^'+\\]*`.

## Validation After Every Patch
Run `vm.Script` parse on all `<script>` blocks and check:
- All scripts: OK
- `fetch targets: ['/api/estimate']`
- `models found: ['claude-sonnet-4-6']`
- `max_tokens found: ['20', '4000', '200']`
- `Raw key exposed: false`
- Brace balance: `open === close` (diff=0 in script2)

## CRITICAL: server.js
`app.options(/.*/, cors(corsOptions))` — MUST use regex `/.*/`, bare `'*'` breaks newer path-to-regexp.

## Secrets
- `ANTHROPIC_KEY` — Anthropic API key (server-side only, never exposed to client)
