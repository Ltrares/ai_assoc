# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Test Commands
- Build app: `npm run build`
- Start dev server: `npm run dev` (runs both client and server concurrently)
- Run client tests: `cd client && npm test`
- Run single client test: `cd client && npm test -- -t "test name pattern"`
- Run client: `npm run client`
- Run server: `npm run server`
- Run server in background: `cd /Users/puffy_fluff/vs_code/ai_association && npm run server &`

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

## Error Handling Requirements
- DO NOT hide errors with fallback mechanisms or automatic recovery
- DO NOT silently replace errors with default values
- DO expose all errors clearly to users/developers
- DO save important data (like cache) when errors occur to prevent loss
- Error messages should be specific and detailed
- When "please note" is used in instructions, update this file with the noted information

## Word Associations Guidelines
- Always use singular forms for word associations (e.g., "balloon" not "balloons")
- Remove "type" field from association objects, use only "word" and "hint" fields
- Minimum of 3 valid associations required for each word
- Words must be intuitive and recognizable by most adults

## Environment Configuration
- API keys and environment variables are stored in the .env file under /server directory
- When running scripts, make sure to look for and load the .env file from the correct location

## Shared Module Architecture
- Core puzzle generation code is in `/server/lib/puzzle-generator.js` 
- Puzzle storage and retrieval in `/server/lib/puzzle-repository.js`
- These modules are used by both:
  1. Server (`/server/index.js`) - For API endpoints and game logic
  2. Standalone script (`/server/scripts/generate-puzzle.js`) - For generating puzzles offline

## Heroku Deployment Notes
- The app returns 503 errors when:
  1. No game has been generated yet (lines 321-328 in server/index.js)
  2. When making API calls before the game initializes (lines 385-392)
  3. Heroku app transitions from "idling" to "up" state (cold start)