# Highest Sales Record Check

A dependency-free Node.js server that displays the highest sales records as HTML tables and also exposes the source data as JSON.

## Requirements

- Node.js 20 or newer
- npm

## Commands

```bash
npm start
npm run dev
npm test
```

Open `http://localhost:3000` after starting the server.

By default, the server binds to `0.0.0.0`, so other devices can access it through the machine's IP address:

```bash
npm start
# http://YOUR_SERVER_IP:3000
```

Customize the bind address and port when needed:

```bash
HOST=0.0.0.0 PORT=5000 npm start
```

## Endpoints

| Data | HTML table | JSON | SVG image | Generate PNG URL |
| --- | --- | --- | --- | --- |
| Branch sales | `/api/branch-sales` | `/api/branch-sales?format=json` | `/api/branch-sales/image` | `/api/branch-sales/image-url` |
| Daily sales | `/api/daily-sales` | `/api/daily-sales?format=json` | `/api/daily-sales/image` | `/api/daily-sales/image-url` |

## Update branch sales records

Send the uploaded sales JSON to:

```text
POST /api/branch-sales/update
```

The endpoint accepts a raw rows array, `{ "data": [...] }`, or the uploaded `[{ "data": [...] }]` shape. It groups rows by the branch code inside `branch_name`, totals `saleamnt`, and updates a branch only when that total is greater than its stored record. The new total is saved to `saleamnt`, while `date` is set to the API server's current date in the `Asia/Yangon` timezone. Updated records receive `is_update_today: true`; all other records receive `false`. Rankings are recalculated after an update.

Override the date timezone when needed with `APP_TIME_ZONE`, for example `APP_TIME_ZONE=Asia/Yangon`.

```bash
curl -X POST http://localhost:3000/api/branch-sales/update \
  -H 'Content-Type: application/json' \
  --data-binary @upload.json
```

To protect this write endpoint on a public server, set `UPDATE_API_KEY`:

```bash
UPDATE_API_KEY=replace-with-a-secret npm start
```

Then send either `Authorization: Bearer replace-with-a-secret` or an `X-API-Key` header.

## Update daily all-branches top 15

Send the same uploaded sales JSON to:

```text
POST /api/daily-sales/update
```

The endpoint totals every uploaded `saleamnt` to produce the all-branches daily total. It inserts that total with the API server's current `Asia/Yangon` date only when it is greater than the current 15th-place amount, marks it with `is_update_today: true`, then sorts descending, recalculates ranks, and keeps exactly 15 records. If today's date already exists, it updates and marks that record only when the new total is higher, preventing duplicate dates.

```bash
curl -X POST http://localhost:3000/api/daily-sales/update \
  -H 'Content-Type: application/json' \
  --data-binary @upload.json
```

`UPDATE_API_KEY` protects this endpoint in the same way as the branch update endpoint.

When `/api/daily-sales/image-url` is called, the daily row with `is_update_today: true` receives the same pastel highlight as an updated branch row. After PNG generation succeeds, the daily flag is persisted back to `false`; a failed image generation leaves it unchanged.

## Delete generated images

Delete all app-generated report PNG files:

```bash
curl -X DELETE http://localhost:3000/api/images
```

When `UPDATE_API_KEY` is configured, include the same `Authorization: Bearer ...` or `X-API-Key` header. The cleanup only removes files matching `report-{timestamp}-{random}.png`; `.gitkeep` and unrelated files inside `images/` are preserved.

Call either PNG URL endpoint with `GET` or `POST`. It returns a response like:

```json
{
  "imageUrl": "http://localhost:3000/images/report-1792380968523-1ff2bc09.png",
  "format": "png"
}
```

When `/api/branch-sales/image-url` is called, branch rows with `is_update_today: true` are highlighted in yellow/orange in the generated PNG. After PNG generation succeeds, those flags are persisted back to `false`. If generation or persistence fails, the flags are left unchanged and the incomplete PNG is removed.

PNG generation requires ImageMagick's `convert` command. In production, set `PUBLIC_BASE_URL` so generated links use your public domain or IP:

```bash
HOST=0.0.0.0 PORT=5000 PUBLIC_BASE_URL=http://178.128.210.194:5000 npm start
```

Generated PNGs use `DejaVu Sans` by default for ImageMagick 6 compatibility. If the server has SF Pro installed, select it without a comma-separated fallback list:

```bash
IMAGE_FONT_FAMILY="SF Pro Text" npm start
```
