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

Call either PNG URL endpoint with `GET` or `POST`. It returns a response like:

```json
{
  "imageUrl": "http://localhost:3000/images/report-1792380968523-1ff2bc09.png",
  "format": "png"
}
```

PNG generation requires ImageMagick's `convert` command. In production, set `PUBLIC_BASE_URL` so generated links use your public domain or IP:

```bash
HOST=0.0.0.0 PORT=5000 PUBLIC_BASE_URL=http://178.128.210.194:5000 npm start
```
