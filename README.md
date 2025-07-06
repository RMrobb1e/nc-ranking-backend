# nc-ranking-backend

A backend API for Night Crows ranking data, built with [Hono](https://hono.dev/) and TypeScript.  
Supports deployment to Node.js hosts (like AlwaysData) and Cloudflare Workers.

## Features

- REST API endpoints for Night Crows ranking data
- Caching until midnight for performance
- CORS support for multiple frontends
- Health and metadata endpoints

## Endpoints

- `GET /api/giphy-key` — Returns the GIPHY API key (from environment variable)
- `GET /api/health` — Health check
- `GET /api/metadata` — Returns regions, weapon types, and ranking types
- `GET /api/growth?ign=&regionCode=` — Fetches growth data for a player
- `GET /api/growth-page?page=&regionCode=` — Fetches paginated growth data
- `GET /api/growth-top-1000?regionCode=` — Top 1000 players by growth
- `GET /api/growth-top-players?regionCode=` — Top players by region and weapon type

## Development

```sh
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server (Node.js, after build)
npm run start:hono
```

## Deployment

### To AlwaysData or Node.js host

1. Build the project:
   ```sh
   npm run build
   ```
2. Copy the `dist/` directory and all necessary files (except `node_modules`) to your server.
3. On the server:
   ```sh
   npm install --production
   node dist/index.js
   ```
   Or use a process manager like `pm2`.

### To Cloudflare Workers

1. Configure your `wrangler.toml` or `wrangler.jsonc`.
2. Deploy:
   ```sh
   npm run deploy
   ```

## Environment Variables

- `GIPHY_API_KEY` — Your GIPHY API key (required)

Set this in your hosting provider’s environment variable settings.

## Formatting

This project uses [Prettier](https://prettier.io/) for code formatting.  
See `.prettierrc` for