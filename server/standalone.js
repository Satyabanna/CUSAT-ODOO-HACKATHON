// Run the app in a normal browser without Electron (handy for development): npm run serve
const path = require('path');
const { start } = require('./app');

start({ dataDir: process.env.BRIGHTLOOP_DATA || path.join(__dirname, '..', 'data'), port: Number(process.env.PORT) || 4300 })
  .then(({ port, file }) => console.log(`LensUS running at http://127.0.0.1:${port}/  (data: ${file})`));
