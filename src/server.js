'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const branchSales = require('../data/branch-sales-records.json');
const dailySales = require('../data/daily-sales-records.json');

const imagesDirectory = path.join(__dirname, '..', 'images');

const routes = {
  '/api/branch-sales': {
    title: 'Highest Sales by Branch',
    theme: 'blue',
    imageFileName: 'branch-sales.svg',
    columns: [
      { key: 'rnk', label: 'rnk' },
      { key: 'branch_code', label: 'branch_code' },
      { key: 'branch_name', label: 'branch_name' },
      { key: 'saleamnt', label: 'saleamnt', format: formatAmount, className: 'number' },
      { key: 'date', label: 'date', format: formatBranchDate }
    ],
    data: branchSales
  },
  '/api/daily-sales': {
    title: 'Highest Daily Sales',
    theme: 'green',
    imageFileName: 'daily-sales.svg',
    columns: [
      { key: 'rnk', label: 'rnk' },
      { key: 'saleamnt', label: 'saleamnt', format: formatAmount, className: 'number' },
      { key: 'date', label: 'date', format: formatDailyDate }
    ],
    data: dailySales
  }
};

function formatAmount(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function getDateParts(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return { year, month, day };
}

function formatBranchDate(isoDate) {
  const { year, month, day } = getDateParts(isoDate);
  return `${Number(month)}/${Number(day)}/${year}`;
}

function formatDailyDate(isoDate) {
  const { year, month, day } = getDateParts(isoDate);
  return `${day}-${month}-${year}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderTable({ title, theme, columns, data }) {
  const header = columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join('');

  const rows = data
    .map((record) => {
      const cells = columns.map((column) => {
        const displayedValue = column.format
          ? column.format(record[column.key])
          : record[column.key];
        const className = column.className ? ` class="${column.className}"` : '';
        return `<td${className}>${escapeHtml(displayedValue)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Calibri, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f5f7fa;
      display: grid;
      place-items: start center;
      padding: 32px 16px;
    }
    .table-wrap {
      max-width: 100%;
      overflow-x: auto;
      border: 1px solid #b7c4d2;
      box-shadow: 0 6px 22px rgba(26, 55, 84, 0.12);
      background: white;
    }
    table {
      border-collapse: collapse;
      min-width: ${theme === 'blue' ? '760px' : '430px'};
      font-size: 18px;
      font-variant-numeric: tabular-nums;
    }
    th, td {
      border: 1px solid #bdcad7;
      padding: 3px 9px;
      white-space: nowrap;
      text-align: left;
    }
    th {
      color: white;
      font-weight: 700;
      background: ${theme === 'blue' ? '#5b9bd5' : '#70c83f'};
    }
    td:first-child { text-align: right; }
    td.number { text-align: right; }
    tr:nth-child(odd) td {
      background: ${theme === 'blue' ? '#d9eaf7' : '#ffffff'};
    }
    tr:nth-child(even) td {
      background: ${theme === 'blue' ? '#ffffff' : '#f4f4f4'};
    }
  </style>
</head>
<body>
  <main class="table-wrap">
    <table aria-label="${escapeHtml(title)}">
      <thead><tr>${header}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function renderTableImage({ title, theme, columns, data }) {
  const columnWidths = theme === 'blue'
    ? [55, 115, 260, 175, 130]
    : [60, 180, 150];
  const headerHeight = 34;
  const rowHeight = 30;
  const width = columnWidths.reduce((total, value) => total + value, 0);
  const height = headerHeight + (data.length * rowHeight);
  const headerColor = theme === 'blue' ? '#5b9bd5' : '#70c83f';
  const oddColor = theme === 'blue' ? '#d9eaf7' : '#ffffff';
  const evenColor = theme === 'blue' ? '#ffffff' : '#f4f4f4';
  const borderColor = '#bdcad7';

  const header = columns.map((column, index) => {
    const x = columnWidths.slice(0, index).reduce((total, value) => total + value, 0);
    return `<g>
      <rect x="${x}" y="0" width="${columnWidths[index]}" height="${headerHeight}" fill="${headerColor}" stroke="${borderColor}"/>
      <text x="${x + 9}" y="22" class="header">${escapeHtml(column.label)}</text>
    </g>`;
  }).join('');

  const rows = data.map((record, rowIndex) => {
    const y = headerHeight + (rowIndex * rowHeight);
    const fill = rowIndex % 2 === 0 ? oddColor : evenColor;
    return columns.map((column, columnIndex) => {
      const x = columnWidths.slice(0, columnIndex).reduce((total, value) => total + value, 0);
      const displayedValue = column.format
        ? column.format(record[column.key])
        : record[column.key];
      const numeric = columnIndex === 0 || column.className === 'number';
      const textX = numeric ? x + columnWidths[columnIndex] - 9 : x + 9;
      const anchor = numeric ? 'end' : 'start';
      return `<g>
        <rect x="${x}" y="${y}" width="${columnWidths[columnIndex]}" height="${rowHeight}" fill="${fill}" stroke="${borderColor}"/>
        <text x="${textX}" y="${y + 21}" text-anchor="${anchor}">${escapeHtml(displayedValue)}</text>
      </g>`;
    }).join('');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
  <style>
    text { font: 18px Calibri, Arial, sans-serif; fill: #111; }
    .header { font-weight: 700; fill: #fff; }
  </style>
  ${header}
  ${rows}
</svg>`;
}

function generatePng(route) {
  fs.mkdirSync(imagesDirectory, { recursive: true });
  const fileName = `report-${Date.now()}-${randomBytes(4).toString('hex')}.png`;
  const filePath = path.join(imagesDirectory, fileName);
  const sourcePath = `${filePath}.svg`;
  const svg = renderTableImage(route);

  try {
    fs.writeFileSync(sourcePath, svg, 'utf8');
    execFileSync('convert', [sourcePath, filePath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000
    });
  } finally {
    fs.rmSync(sourcePath, { force: true });
  }

  return { fileName, filePath };
}

function getPublicBaseUrl(request) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const forwardedProtocol = request.headers['x-forwarded-proto'];
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
  const host = request.headers.host || 'localhost:3000';
  return `${protocol}://${host}`;
}

function serveGeneratedImage(requestUrl, response) {
  const fileName = path.basename(requestUrl.pathname);

  if (!/^report-[0-9]+-[a-f0-9]{8}\.png$/.test(fileName)) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Image not found' }));
    return;
  }

  const filePath = path.join(imagesDirectory, fileName);

  try {
    const image = fs.readFileSync(filePath);
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': image.length,
      'Cache-Control': 'public, max-age=86400'
    });
    response.end(image);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Unable to read generated image:', error);
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Image not found' }));
  }
}

function renderIndex() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sales APIs</title></head>
<body style="font-family:Arial,sans-serif;padding:32px;line-height:1.7">
  <h1>Sales APIs</h1>
  <ul>
    <li><a href="/api/branch-sales">Branch sales table</a></li>
    <li><a href="/api/branch-sales/image">Branch sales image</a></li>
    <li><a href="/api/branch-sales/image-url">Generate branch sales PNG URL</a></li>
    <li><a href="/api/daily-sales">Daily sales table</a></li>
    <li><a href="/api/daily-sales/image">Daily sales image</a></li>
    <li><a href="/api/daily-sales/image-url">Generate daily sales PNG URL</a></li>
  </ul>
  <p>Add <code>?format=json</code> to either URL for a JSON response.</p>
</body>
</html>`;
}

function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const isGeneratedImageRequest = requestUrl.pathname.startsWith('/images/');
  const isImageUrlRequest = requestUrl.pathname.endsWith('/image-url');
  const isImageRequest = requestUrl.pathname.endsWith('/image');
  const routePath = isImageUrlRequest
    ? requestUrl.pathname.slice(0, -10)
    : isImageRequest
      ? requestUrl.pathname.slice(0, -6)
      : requestUrl.pathname;
  const route = routes[routePath];

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (isGeneratedImageRequest) {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    serveGeneratedImage(requestUrl, response);
    return;
  }

  if (request.method !== 'GET' && !(isImageUrlRequest && request.method === 'POST')) {
    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (requestUrl.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderIndex());
    return;
  }

  if (!route) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (isImageUrlRequest) {
    try {
      const { fileName } = generatePng(route);
      const imageUrl = `${getPublicBaseUrl(request)}/images/${fileName}`;
      response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ imageUrl, format: 'png' }, null, 2));
    } catch (error) {
      console.error('Unable to generate PNG:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        error: 'Unable to generate PNG image',
        detail: 'ImageMagick convert must be installed on the server.'
      }));
    }
    return;
  }

  if (isImageRequest) {
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': `inline; filename="${route.imageFileName}"`,
      'Cache-Control': 'no-store'
    });
    response.end(renderTableImage(route));
    return;
  }

  if (requestUrl.searchParams.get('format') === 'json') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(route.data, null, 2));
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(renderTable(route));
}

function createApp() {
  return http.createServer(handleRequest);
}

module.exports = { createApp, handleRequest, renderTable, renderTableImage };
