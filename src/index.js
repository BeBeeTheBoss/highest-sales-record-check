'use strict';

const os = require('node:os');
const { createApp } = require('./server');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const server = createApp();

function getNetworkAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((network) => network && network.family === 'IPv4' && !network.internal)
    .map((network) => network.address);
}

server.listen(port, host, () => {
  console.log(`Highest Sales Record Check is listening on ${host}:${port}`);
  console.log(`Local:   http://localhost:${port}`);

  if (host === '0.0.0.0') {
    for (const address of getNetworkAddresses()) {
      console.log(`Network: http://${address}:${port}`);
    }
  } else if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log(`Host:    http://${host}:${port}`);
  }

  if (process.env.PUBLIC_BASE_URL) {
    console.log(`Public:  ${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}`);
  }

  console.log(`Branch sales: /api/branch-sales`);
  console.log(`Daily sales:  /api/daily-sales`);
});
