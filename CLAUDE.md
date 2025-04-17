# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands
- Build app: `npm run build`
- Start dev server: `npm run dev` (runs both client and server concurrently)
- Run client tests: `cd client && npm test`
- Run single client test: `cd client && npm test -- -t "test name pattern"`
- Run client: `npm run client`
- Run server: `npm run server`

## Code Style Guidelines
- Client: React functional components with hooks (useState, useEffect)
- Server: Express.js with CommonJS modules
- Import order: React imports first, followed by other libraries, then local imports
- Naming: camelCase for variables/functions, PascalCase for components
- Indentation: 2 spaces
- Error handling: try/catch blocks with console.error and user-friendly fallbacks
- Comments: JSDoc style for functions, inline for complex logic explanation
- ES6+ features preferred (arrow functions, destructuring, template literals)
- Follow eslint rules: "react-app" and "react-app/jest" presets

## Heroku Deployment Notes
- The app returns 503 errors when:
  1. No game has been generated yet (lines 605-612 in server/index.js)
  2. When making API calls before the game initializes (lines 634-638)
  3. Heroku app transitions from "idling" to "up" state (cold start)