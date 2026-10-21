'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  calculateBranchSalesUpdates,
  calculateDailySalesUpdate,
  deleteGeneratedImages,
  handleRequest,
  renderTableImage
} = require('../src/server');

function request(url, method = 'GET') {
  const result = { headers: {} };
  const response = {
    setHeader(name, value) {
      result.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      result.status = status;
      for (const [name, value] of Object.entries(headers)) {
        result.headers[name.toLowerCase()] = value;
      }
    },
    end(body = '') {
      result.body = body;
    }
  };

  handleRequest({ url, method, headers: { host: 'localhost' } }, response);
  return result;
}

test('branch sales endpoint returns the blue HTML table', () => {
  const response = request('/api/branch-sales');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /MM-105/);
  assert.match(response.body, /Mawlamyine/);
  assert.match(response.body, /1,885,058,600/);
  assert.match(response.body, /09-11-2025/);
});

test('daily sales endpoint returns the green HTML table', () => {
  const response = request('/api/daily-sales');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.body, /4,277,137,492/);
  assert.match(response.body, /31-05-2026/);
});

test('format=json returns reusable JSON data', () => {
  const response = request('/api/branch-sales?format=json');
  const data = JSON.parse(response.body);

  assert.equal(response.status, 200);
  assert.equal(data.length, 14);
  assert.equal(data[0].branch_code, 'MM-105');
});

test('branch image endpoint returns an SVG image file', () => {
  const response = request('/api/branch-sales/image');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /image\/svg\+xml/);
  assert.match(response.headers['content-disposition'], /branch-sales\.svg/);
  assert.match(response.body, /^<svg/);
  assert.match(response.body, /Mawlamyine/);
  assert.match(response.body, /1,885,058,600/);
});

test('daily image endpoint returns an SVG image file', () => {
  const response = request('/api/daily-sales/image');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /image\/svg\+xml/);
  assert.match(response.headers['content-disposition'], /daily-sales\.svg/);
  assert.match(response.body, /^<svg/);
  assert.match(response.body, /4,277,137,492/);
});

test('image-url endpoint generates and serves a PNG URL', () => {
  const generated = request('/api/branch-sales/image-url', 'POST');
  const payload = JSON.parse(generated.body);
  const imagePath = new URL(payload.imageUrl).pathname;
  const imageFile = path.join(__dirname, '..', imagePath);

  try {
    assert.equal(generated.status, 201);
    assert.match(payload.imageUrl, /^http:\/\/localhost\/images\/report-[0-9]+-[a-f0-9]{8}\.png$/);
    assert.equal(payload.format, 'png');

    const served = request(imagePath);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.ok(Buffer.isBuffer(served.body));
    assert.deepEqual(served.body.subarray(1, 4), Buffer.from('PNG'));
  } finally {
    if (fs.existsSync(imageFile)) {
      fs.unlinkSync(imageFile);
    }
  }
});

test('uploaded rows are totaled by branch and only a new record is updated', () => {
  const records = [
    { rnk: 1, branch_code: 'MM-101', branch_name: 'Lanthit', saleamnt: 200, date: '2026-01-01' },
    { rnk: 2, branch_code: 'MM-105', branch_name: 'Mawlamyine', saleamnt: 100, date: '2026-01-01' }
  ];
  const payload = [{
    data: [
      { branch_name: 'MM-105-/-Mawlamyine', dtype: 'Daily : 19/10/2026', saleamnt: '60.2500' },
      { branch_name: 'MM-105-/-Mawlamyine', dtype: 'Daily : 19/10/2026', saleamnt: '40.2500' }
    ]
  }];

  const result = calculateBranchSalesUpdates(records, payload, '2026-10-20');
  const updated = result.records.find((record) => record.branch_code === 'MM-105');
  const untouched = result.records.find((record) => record.branch_code === 'MM-101');

  assert.equal(result.updatedBranches.length, 1);
  assert.equal(result.processedRows, 2);
  assert.equal(updated.saleamnt, 100.5);
  assert.equal(result.reportDate, '2026-10-19');
  assert.equal(result.updateDate, '2026-10-20');
  assert.equal(updated.date, '2026-10-20');
  assert.equal(updated.is_update_today, true);
  assert.equal(untouched.saleamnt, 200);
  assert.equal(untouched.is_update_today, false);
});

test('uploaded rows with mixed report dates are rejected', () => {
  const records = [
    { rnk: 1, branch_code: 'MM-105', branch_name: 'Mawlamyine', saleamnt: 100, date: '2026-01-01' }
  ];
  const payload = { data: [
    { branch_name: 'MM-105-/-Mawlamyine', dtype: 'Daily : 19/10/2026', saleamnt: '60' },
    { branch_name: 'MM-105-/-Mawlamyine', dtype: 'Daily : 20/10/2026', saleamnt: '60' }
  ] };

  assert.throws(
    () => calculateBranchSalesUpdates(records, payload),
    /same report date/
  );
});

test('branch image highlights records updated today', () => {
  const svg = renderTableImage({
    title: 'Test Branch Sales',
    theme: 'blue',
    columns: [
      { key: 'rnk', label: 'rnk' },
      { key: 'branch_code', label: 'branch_code' },
      { key: 'branch_name', label: 'branch_name' },
      { key: 'saleamnt', label: 'saleamnt', className: 'number' },
      { key: 'date', label: 'date' }
    ],
    data: [{
      rnk: 1,
      branch_code: 'MM-105',
      branch_name: 'Mawlamyine',
      saleamnt: 200,
      date: '2026-10-20',
      is_update_today: true
    }]
  });

  assert.match(svg, /fill="#fffaf0"/);
  assert.match(svg, /fill="#d6b656"/);
  assert.match(svg, /class="updated"/);
  assert.match(svg, /width="872"/);
  assert.match(svg, /font-family="DejaVu Sans"/);
});

test('all-branches total enters the daily top 15 and displaces the lowest record', () => {
  const records = Array.from({ length: 15 }, (_, index) => ({
    rnk: index + 1,
    saleamnt: 1500 - (index * 100),
    date: `2026-09-${String(index + 1).padStart(2, '0')}`
  }));
  const payload = { data: [
    { dtype: 'Daily : 19/10/2026', saleamnt: '100.0000' },
    { dtype: 'Daily : 19/10/2026', saleamnt: '50.0000' }
  ] };

  const result = calculateDailySalesUpdate(records, payload, '2026-10-20');

  assert.equal(result.allBranchesTotal, 150);
  assert.equal(result.action, 'inserted');
  assert.equal(result.isTop15, true);
  assert.equal(result.records.length, 15);
  assert.equal(result.records.at(-1).saleamnt, 150);
  assert.equal(result.records.at(-1).date, '2026-10-20');
  assert.equal(result.records.at(-1).is_update_today, true);
  assert.equal(result.records.filter((record) => record.is_update_today).length, 1);
  assert.equal(result.displacedRecord.saleamnt, 100);
  assert.deepEqual(result.records.map((record) => record.rnk), Array.from({ length: 15 }, (_, index) => index + 1));
});

test('all-branches total below the daily top 15 is ignored', () => {
  const records = Array.from({ length: 15 }, (_, index) => ({
    rnk: index + 1,
    saleamnt: 1500 - (index * 100),
    date: `2026-09-${String(index + 1).padStart(2, '0')}`
  }));
  const payload = { data: [
    { dtype: 'Daily : 19/10/2026', saleamnt: '40.0000' },
    { dtype: 'Daily : 19/10/2026', saleamnt: '50.0000' }
  ] };

  const result = calculateDailySalesUpdate(records, payload, '2026-10-20');

  assert.equal(result.allBranchesTotal, 90);
  assert.equal(result.action, 'not_qualified');
  assert.equal(result.isTop15, false);
  assert.equal(result.records.length, 15);
  assert.equal(result.records.at(-1).saleamnt, 100);
  assert.equal(result.records.every((record) => record.is_update_today === false), true);
});

test('image cleanup deletes only generated report PNG files', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-images-test-'));
  const generatedFiles = [
    'report-1792380968523-1ff2bc09.png',
    'report-1792380968524-aabbccdd.png'
  ];

  try {
    for (const fileName of generatedFiles) {
      fs.writeFileSync(path.join(temporaryDirectory, fileName), 'generated image');
    }
    fs.writeFileSync(path.join(temporaryDirectory, '.gitkeep'), '');
    fs.writeFileSync(path.join(temporaryDirectory, 'keep-this.png'), 'user image');

    const deletedFiles = deleteGeneratedImages(temporaryDirectory);

    assert.deepEqual(deletedFiles, generatedFiles);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, generatedFiles[0])), false);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, '.gitkeep')), true);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, 'keep-this.png')), true);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
