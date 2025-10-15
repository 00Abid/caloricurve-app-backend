# CalorieCurve Backend

Express-based API powering food lookups and nutrition suggestions.

- Runtime: Node.js (>= 18)
- Frameworks: `express`, `cors`, `dotenv`
- AI: `@google/generative-ai` (Gemini) — requires `GEMINI_API_KEY`

## Quick Start

1. Install Node 18+.
2. Clone and install:
   ```bash
   npm install
   ```
3. Create a `.env` file (local dev):
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   NODE_ENV=development
   # Comma-separated list; leave empty to allow all in dev
   CORS_ORIGINS=http://localhost:5173,https://your-frontend.example
   ```
4. Run the server:
   ```bash
   npm start
   ```
5. Verify:
   - `GET http://localhost:3001/` → "CalorieCurve API OK"
   - `GET http://localhost:3001/healthz` → "ok"

## Environment Variables

- `GEMINI_API_KEY` (required): Enables AI-powered endpoints (`/api/foods`, `/api/suggestions`).
- `NODE_ENV` (recommended): Set to `production` in Render.
- `PORT` (do not set on Render): Render injects this; locally defaults to `3001`.
- `CORS_ORIGINS` (optional): Comma-separated origins allowed by CORS.
  - Empty or unset → allow all origins (useful for local/dev).
  - Set for production to your real frontend domains.

## API Endpoints

- `GET /`
  - Returns a simple 200 text response: "CalorieCurve API OK".

- `GET /healthz`
  - Health check endpoint returning 200 and "ok".

- `GET /api/foods?query=<text>`
  - Query: text describing food; you can include amounts with units (e.g., `banana 150g`, `milk 250ml`).
  - Requires `GEMINI_API_KEY`.
  - Response:
    ```json
    {
      "results": [
        {
          "name": "Banana",
          "portion": "1 medium (118g)",
          "calories": 105,
          "protein": 1.3,
          "carbs": 27,
          "fat": 0.3,
          "fiber": 3.1,
          "sugar": 14.4,
          "sodium": 1,
          "iron": 0.31,
          "zinc": 0.18,
          "calcium": 6,
          "vitaminB12": 0,
          "vitaminD": 0,
          "vitaminA": 9,
          "omega3": 0,
          "vitaminC": 10.3,
          "magnesium": 32,
          "potassium": 422
        }
      ]
    }
    ```
  - If the query contains a measurable amount (e.g. `150g`), results are scaled accordingly.

- `POST /api/suggestions`
  - Body:
    ```json
    {
      "totalNutrients": { /* aggregated day totals */ },
      "dailyGoals": { /* target goals */ },
      "meals": [ /* optional recent meals */ ]
    }
    ```
  - Requires `GEMINI_API_KEY`.
  - Response:
    ```json
    {
      "suggestions": [
        "Add 1 cup Greek yogurt for protein",
        "Include leafy greens to boost magnesium"
      ]
    }
    ```

## CORS

CORS is controlled by `CORS_ORIGINS` (comma-separated). Examples:

- Development (allow all): leave `CORS_ORIGINS` empty.
- Production (restrict to domains):
  ```
  CORS_ORIGINS=https://your-frontend.onrender.com,https://www.yourdomain.com
  ```
If you need cookies/auth between frontend and backend, enable credentials and specific headers in the CORS config (can be added on request).

## Deploy to Render

This repo includes `render.yaml` to define the service.

- Build: `npm install`
- Start: `npm start`
- Health check: `/healthz`
- Env vars: `GEMINI_API_KEY` (set in dashboard), `NODE_ENV=production`, `CORS_ORIGINS`

Steps:

1. Push the repo to GitHub.
2. In Render, create a new Web Service pointing to the repo.
   - If using Blueprints, Render auto-detects `render.yaml`.
3. Set environment variables:
   - `GEMINI_API_KEY` (required)
   - `NODE_ENV=production`
   - `CORS_ORIGINS` (your frontend domains)
4. Deploy and verify:
   - `GET https://<service>.onrender.com/` → "CalorieCurve API OK"
   - `GET https://<service>.onrender.com/healthz` → "ok"

Notes:

- The server binds to `0.0.0.0` and uses `process.env.PORT`, which Render provides.
- Do not hardcode `PORT` for Render.

## Troubleshooting

- 500 with message `GEMINI_API_KEY not configured on server` → set the key.
- Health check failing → confirm `/healthz` returns 200 and no errors in logs.
- CORS blocked → set `CORS_ORIGINS` to include your frontend origin(s).
- Node version errors → ensure Node 18+ (package.json enforces `engines.node ">=18"`).

## License

Proprietary/Unlicensed unless specified by the project owner.