# Spence Contracting – Project Manager

## Overview
A single-page web application for tracking construction and renovation projects for Spence Contracting. Built with pure vanilla HTML, CSS, and JavaScript — no build tools or external dependencies required.

## Project Structure
- `Index.html` — The entire application (HTML, CSS, and JavaScript in one file)
- `serve.py` — Lightweight Python HTTP server that serves `Index.html` at the root path

## Running the App
The app is served via a Python HTTP server on port 5000:
```
python3 serve.py
```

## Tech Stack
- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6) — no frameworks
- **Backend:** None (client-side only, in-memory data)
- **Build System:** None

## Features
- Project dashboard with stats (jobs, active, budget, spent)
- Search and filter projects by status (Planning, In Progress, On Hold, Completed)
- Progress tracking with visual progress bars
- Tabbed detail view (Timeline, Choices, Budget, Notes)
- Add new projects via form

## Deployment
Configured as a static site deployment. The `Index.html` file is the entire application.
