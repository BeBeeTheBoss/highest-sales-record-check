'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const branchSales = require('../data/branch-sales-records.json');
const dailySales = require('../data/daily-sales-records.json');

const imagesDirectory = path.join(__dirname, '..', 'images');
const branchSalesFile = path.join(__dirname, '..', 'data', 'branch-sales-records.json');
const dailySalesFile = path.join(__dirname, '..', 'data', 'daily-sales-records.json');
const maxJsonBodySize = 10 * 1024 * 1024;
const generatedImageFilePattern = /^report-[0-9]+-[a-f0-9]{8}\.png$/;

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
  return `${day}-${month}-${year}`;
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

function createRequestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function extractSalesRows(payload) {
  if (payload && !Array.isArray(payload) && Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload)) {
    const wrappedPayload = payload.length > 0
      && payload.every((item) => item && Array.isArray(item.data));
    return wrappedPayload ? payload.flatMap((item) => item.data) : payload;
  }

  throw createRequestError('Payload must be an array, an object with a data array, or an array of objects with data arrays.');
}

function parseReportDate(dtype, rowNumber) {
  const match = /^Daily\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/i.exec(String(dtype || '').trim());
  if (!match) {
    throw createRequestError(`Row ${rowNumber}: dtype must use "Daily : DD/MM/YYYY" format.`);
  }

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw createRequestError(`Row ${rowNumber}: dtype contains an invalid date.`);
  }

  return `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseScaledAmount(value, rowNumber) {
  const normalized = String(value ?? '').replaceAll(',', '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);

  if (!match) {
    throw createRequestError(`Row ${rowNumber}: saleamnt must be a valid number.`);
  }

  const [, sign, whole, fraction = ''] = match;
  const roundedFraction = fraction.padEnd(5, '0');
  let scaled = (BigInt(whole) * 10000n) + BigInt(roundedFraction.slice(0, 4));

  if (Number(roundedFraction[4]) >= 5) {
    scaled += 1n;
  }

  return sign === '-' ? -scaled : scaled;
}

function scaledAmountToNumber(value) {
  const amount = Number(value) / 10000;
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Number(value))) {
    throw createRequestError('A branch total is too large to store safely.');
  }
  return amount;
}

function getTodayDate(timeZone = process.env.APP_TIME_ZONE || 'Asia/Yangon') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function calculateBranchSalesUpdates(currentRecords, payload, updateDate = getTodayDate()) {
  const rows = extractSalesRows(payload);
  if (rows.length === 0) {
    throw createRequestError('Payload data must contain at least one sales row.');
  }

  const groupedBranches = new Map();
  const reportDates = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw createRequestError(`Row ${rowNumber}: each sales row must be an object.`);
    }

    const branchMatch = /^(MM-\d+)-\/-(.+)$/.exec(String(row.branch_name || '').trim());
    if (!branchMatch) {
      throw createRequestError(`Row ${rowNumber}: branch_name must use "MM-000-/-Branch Name" format.`);
    }

    const [, branchCode, branchName] = branchMatch;
    const reportDate = parseReportDate(row.dtype, rowNumber);
    const scaledAmount = parseScaledAmount(row.saleamnt, rowNumber);
    reportDates.add(reportDate);

    const branch = groupedBranches.get(branchCode) || {
      branch_code: branchCode,
      branch_name: branchName.trim(),
      totalScaled: 0n,
      rowCount: 0
    };

    if (branch.branch_name !== branchName.trim()) {
      throw createRequestError(`Row ${rowNumber}: branch code ${branchCode} has conflicting branch names.`);
    }

    branch.totalScaled += scaledAmount;
    branch.rowCount += 1;
    groupedBranches.set(branchCode, branch);
  });

  if (reportDates.size !== 1) {
    throw createRequestError('All uploaded rows must have the same report date.');
  }

  const [reportDate] = reportDates;
  const knownBranchCodes = new Set(currentRecords.map((record) => record.branch_code));
  const updatedBranches = [];
  const unchangedBranches = [];
  const unmatchedBranches = [];

  for (const branch of groupedBranches.values()) {
    if (!knownBranchCodes.has(branch.branch_code)) {
      unmatchedBranches.push({
        branch_code: branch.branch_code,
        branch_name: branch.branch_name,
        uploaded_total: scaledAmountToNumber(branch.totalScaled),
        row_count: branch.rowCount
      });
    }
  }

  const updatedRecords = currentRecords.map((record) => {
    const branch = groupedBranches.get(record.branch_code);
    const baseRecord = { ...record, is_update_today: false };

    if (!branch) {
      return baseRecord;
    }

    const currentScaled = parseScaledAmount(record.saleamnt, `record ${record.branch_code}`);
    const uploadedTotal = scaledAmountToNumber(branch.totalScaled);

    if (branch.totalScaled <= currentScaled) {
      unchangedBranches.push({
        branch_code: record.branch_code,
        branch_name: record.branch_name,
        current_total: record.saleamnt,
        uploaded_total: uploadedTotal,
        row_count: branch.rowCount
      });
      return baseRecord;
    }

    updatedBranches.push({
      branch_code: record.branch_code,
      branch_name: record.branch_name,
      previous_total: record.saleamnt,
      uploaded_total: uploadedTotal,
      date: updateDate,
      row_count: branch.rowCount,
      is_update_today: true
    });

    return {
      ...baseRecord,
      saleamnt: uploadedTotal,
      date: updateDate,
      is_update_today: true
    };
  });

  updatedRecords.sort((left, right) => right.saleamnt - left.saleamnt || left.branch_code.localeCompare(right.branch_code));
  updatedRecords.forEach((record, index) => {
    record.rnk = index + 1;
  });

  return {
    reportDate,
    updateDate,
    processedRows: rows.length,
    processedBranches: groupedBranches.size,
    updatedBranches,
    unchangedBranches,
    unmatchedBranches,
    records: updatedRecords
  };
}

function persistBranchSalesUpdates(payload) {
  const currentRecords = JSON.parse(fs.readFileSync(branchSalesFile, 'utf8'));
  const result = calculateBranchSalesUpdates(currentRecords, payload);
  writeBranchSalesRecords(result.records);
  return result;
}

function writeBranchSalesRecords(records) {
  const temporaryFile = `${branchSalesFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryFile, branchSalesFile);
  } finally {
    fs.rmSync(temporaryFile, { force: true });
  }

  branchSales.splice(0, branchSales.length, ...records);
}

function resetBranchUpdateFlags() {
  const highlightedBranches = branchSales
    .filter((record) => record.is_update_today === true)
    .map((record) => record.branch_code);

  if (highlightedBranches.length === 0) {
    return highlightedBranches;
  }

  const resetRecords = branchSales.map((record) => ({
    ...record,
    is_update_today: false
  }));
  writeBranchSalesRecords(resetRecords);
  return highlightedBranches;
}

function calculateDailySalesUpdate(currentRecords, payload, updateDate = getTodayDate()) {
  const rows = extractSalesRows(payload);
  if (rows.length === 0) {
    throw createRequestError('Payload data must contain at least one sales row.');
  }

  const reportDates = new Set();
  let totalScaled = 0n;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw createRequestError(`Row ${rowNumber}: each sales row must be an object.`);
    }

    reportDates.add(parseReportDate(row.dtype, rowNumber));
    totalScaled += parseScaledAmount(row.saleamnt, rowNumber);
  });

  if (reportDates.size !== 1) {
    throw createRequestError('All uploaded rows must have the same report date.');
  }

  const [reportDate] = reportDates;
  const allBranchesTotal = scaledAmountToNumber(totalScaled);
  const records = currentRecords.map((record) => ({
    ...record,
    is_update_today: false
  }));
  const existingToday = records.find((record) => record.date === updateDate);
  let action = 'not_qualified';
  let displacedRecord = null;

  if (existingToday) {
    if (totalScaled > parseScaledAmount(existingToday.saleamnt, `record ${existingToday.date}`)) {
      existingToday.saleamnt = allBranchesTotal;
      existingToday.is_update_today = true;
      action = 'updated_today';
    } else {
      action = 'not_higher_for_today';
    }
  } else {
    const lowestRecord = records.reduce((lowest, record) => (
      !lowest || record.saleamnt < lowest.saleamnt ? record : lowest
    ), null);
    const qualifies = records.length < 15
      || !lowestRecord
      || totalScaled > parseScaledAmount(lowestRecord.saleamnt, `record ${lowestRecord.date}`);

    if (qualifies) {
      records.push({
        rnk: 0,
        saleamnt: allBranchesTotal,
        date: updateDate,
        is_update_today: true
      });
      action = 'inserted';
    }
  }

  records.sort((left, right) => right.saleamnt - left.saleamnt || right.date.localeCompare(left.date));

  if (records.length > 15) {
    displacedRecord = records[15];
    records.length = 15;
  }

  records.forEach((record, index) => {
    record.rnk = index + 1;
  });

  return {
    reportDate,
    updateDate,
    processedRows: rows.length,
    allBranchesTotal,
    action,
    isTop15: action === 'inserted' || action === 'updated_today',
    displacedRecord,
    records
  };
}

function writeDailySalesRecords(records) {
  const temporaryFile = `${dailySalesFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryFile, dailySalesFile);
  } finally {
    fs.rmSync(temporaryFile, { force: true });
  }

  dailySales.splice(0, dailySales.length, ...records);
}

function persistDailySalesUpdate(payload) {
  const currentRecords = JSON.parse(fs.readFileSync(dailySalesFile, 'utf8'));
  const result = calculateDailySalesUpdate(currentRecords, payload);

  if (result.isTop15) {
    writeDailySalesRecords(result.records);
  }

  return result;
}

function resetDailyUpdateFlags() {
  const highlightedDates = dailySales
    .filter((record) => record.is_update_today === true)
    .map((record) => record.date);

  if (highlightedDates.length === 0) {
    return highlightedDates;
  }

  const resetRecords = dailySales.map((record) => ({
    ...record,
    is_update_today: false
  }));
  writeDailySalesRecords(resetRecords);
  return highlightedDates;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxJsonBodySize) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (tooLarge) {
        reject(createRequestError('JSON payload exceeds the 10 MB limit.', 413));
        return;
      }

      try {
        const body = Buffer.concat(chunks).toString('utf8').trim();
        if (!body) {
          throw createRequestError('Request body must contain JSON data.');
        }
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error.statusCode ? error : createRequestError('Request body contains invalid JSON.'));
      }
    });

    request.on('error', () => reject(createRequestError('Unable to read request body.')));
  });
}

function isUpdateAuthorized(request) {
  const expectedKey = process.env.UPDATE_API_KEY;
  if (!expectedKey) {
    return true;
  }

  return request.headers.authorization === `Bearer ${expectedKey}`
    || request.headers['x-api-key'] === expectedKey;
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
    ? [55, 140, 260, 175, 130]
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
    const isUpdatedToday = record.is_update_today === true;
    const fill = isUpdatedToday
      ? '#fff2cc'
      : rowIndex % 2 === 0 ? oddColor : evenColor;
    const cellBorderColor = isUpdatedToday ? '#d6b656' : borderColor;
    const strokeWidth = isUpdatedToday ? 2 : 1;
    const textClass = isUpdatedToday ? ' class="updated"' : '';
    return columns.map((column, columnIndex) => {
      const x = columnWidths.slice(0, columnIndex).reduce((total, value) => total + value, 0);
      const displayedValue = column.format
        ? column.format(record[column.key])
        : record[column.key];
      const numeric = columnIndex === 0 || column.className === 'number';
      const textX = numeric ? x + columnWidths[columnIndex] - 9 : x + 9;
      const anchor = numeric ? 'end' : 'start';
      return `<g>
        <rect x="${x}" y="${y}" width="${columnWidths[columnIndex]}" height="${rowHeight}" fill="${fill}" stroke="${cellBorderColor}" stroke-width="${strokeWidth}"/>
        <text x="${textX}" y="${y + 21}" text-anchor="${anchor}"${textClass}>${escapeHtml(displayedValue)}</text>
      </g>`;
    }).join('');
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
  <style>
    text { font: 18px Calibri, Arial, sans-serif; fill: #111; }
    .header { font-weight: 700; fill: #fff; }
    .updated { font-weight: 700; fill: #7f6000; }
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

  if (!generatedImageFilePattern.test(fileName)) {
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

function deleteGeneratedImages(directory = imagesDirectory) {
  fs.mkdirSync(directory, { recursive: true });
  const deletedFiles = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !generatedImageFilePattern.test(entry.name)) {
      continue;
    }

    fs.rmSync(path.join(directory, entry.name));
    deletedFiles.push(entry.name);
  }

  return deletedFiles.sort();
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
    <li><code>POST /api/branch-sales/update</code> — update branch records from uploaded sales JSON</li>
    <li><a href="/api/daily-sales">Daily sales table</a></li>
    <li><a href="/api/daily-sales/image">Daily sales image</a></li>
    <li><a href="/api/daily-sales/image-url">Generate daily sales PNG URL</a></li>
    <li><code>POST /api/daily-sales/update</code> — update the all-branches daily top 15</li>
    <li><code>DELETE /api/images</code> — delete all generated report PNG files</li>
  </ul>
  <p>Add <code>?format=json</code> to either URL for a JSON response.</p>
</body>
</html>`;
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const isGeneratedImageRequest = requestUrl.pathname.startsWith('/images/');
  const isImageUrlRequest = requestUrl.pathname.endsWith('/image-url');
  const isImageRequest = requestUrl.pathname.endsWith('/image');
  const isBranchUpdateRequest = requestUrl.pathname === '/api/branch-sales/update';
  const isDailyUpdateRequest = requestUrl.pathname === '/api/daily-sales/update';
  const isDeleteImagesRequest = requestUrl.pathname === '/api/images';
  const isUpdateRequest = isBranchUpdateRequest || isDailyUpdateRequest;
  const routePath = isImageUrlRequest
    ? requestUrl.pathname.slice(0, -10)
    : isImageRequest
      ? requestUrl.pathname.slice(0, -6)
      : requestUrl.pathname;
  const route = routes[routePath];

  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (isDeleteImagesRequest) {
    if (request.method !== 'DELETE') {
      response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'DELETE' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (!isUpdateAuthorized(request)) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const deletedFiles = deleteGeneratedImages();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: true,
        deleted_count: deletedFiles.length,
        deleted_files: deletedFiles
      }, null, 2));
    } catch (error) {
      console.error('Unable to delete generated images:', error);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: false,
        error: 'Unable to delete generated images.'
      }));
    }
    return;
  }

  if (isGeneratedImageRequest) {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
      response.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    serveGeneratedImage(requestUrl, response);
    return;
  }

  if (isUpdateRequest && request.method !== 'POST') {
    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (!isUpdateRequest && request.method !== 'GET' && !(isImageUrlRequest && request.method === 'POST')) {
    response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  if (requestUrl.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(renderIndex());
    return;
  }

  if (isBranchUpdateRequest) {
    if (!isUpdateAuthorized(request)) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = persistBranchSalesUpdates(payload);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: true,
        report_date: result.reportDate,
        updated_date: result.updateDate,
        processed_rows: result.processedRows,
        processed_branches: result.processedBranches,
        updated_count: result.updatedBranches.length,
        updated_branches: result.updatedBranches,
        unchanged_branches: result.unchangedBranches,
        unmatched_branches: result.unmatchedBranches,
        records: result.records
      }, null, 2));
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) {
        console.error('Unable to update branch sales:', error);
      }
      response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: false,
        error: statusCode === 500 ? 'Unable to update branch sales records.' : error.message
      }));
    }
    return;
  }

  if (isDailyUpdateRequest) {
    if (!isUpdateAuthorized(request)) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      const payload = await readJsonBody(request);
      const result = persistDailySalesUpdate(payload);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: true,
        report_date: result.reportDate,
        updated_date: result.updateDate,
        processed_rows: result.processedRows,
        all_branches_total: result.allBranchesTotal,
        action: result.action,
        is_top_15: result.isTop15,
        displaced_record: result.displacedRecord,
        records: result.records
      }, null, 2));
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) {
        console.error('Unable to update daily sales:', error);
      }
      response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        success: false,
        error: statusCode === 500 ? 'Unable to update daily sales records.' : error.message
      }));
    }
    return;
  }

  if (!route) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (isImageUrlRequest) {
    let generatedFilePath;
    try {
      const { fileName, filePath } = generatePng(route);
      generatedFilePath = filePath;
      const highlightedBranches = routePath === '/api/branch-sales'
        ? resetBranchUpdateFlags()
        : [];
      const highlightedDates = routePath === '/api/daily-sales'
        ? resetDailyUpdateFlags()
        : [];
      const imageUrl = `${getPublicBaseUrl(request)}/images/${fileName}`;
      response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        imageUrl,
        format: 'png',
        highlightedBranches,
        highlightedDates,
        updateFlagsReset: routePath === '/api/branch-sales' || routePath === '/api/daily-sales'
      }, null, 2));
    } catch (error) {
      if (generatedFilePath) {
        fs.rmSync(generatedFilePath, { force: true });
      }
      console.error('Unable to generate PNG or reset update flags:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        error: 'Unable to generate PNG image or reset branch update flags.',
        detail: 'Verify ImageMagick and data-file write permissions on the server.'
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

module.exports = {
  calculateBranchSalesUpdates,
  calculateDailySalesUpdate,
  createApp,
  deleteGeneratedImages,
  handleRequest,
  renderTable,
  renderTableImage
};
