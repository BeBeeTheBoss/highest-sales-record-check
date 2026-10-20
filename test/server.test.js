'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handleRequest } = require('../src/server');

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
