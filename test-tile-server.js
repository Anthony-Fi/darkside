const http = require('http');
const fs = require('fs');
const path = require('path');

function findAnyPngUnder(dir) {
  if (!fs.existsSync(dir)) return null;
  const zs = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());
  zs.sort((a, b) => parseInt(a) - parseInt(b));
  for (const z of zs) {
    const zDir = path.join(dir, z);
    const xs = fs.readdirSync(zDir).filter((d) => fs.statSync(path.join(zDir, d)).isDirectory());
    xs.sort((a, b) => parseInt(a) - parseInt(b));
    for (const x of xs) {
      const xDir = path.join(zDir, x);
      const ys = fs.readdirSync(xDir).filter((f) => f.endsWith('.png'));
      ys.sort((a, b) => parseInt(a) - parseInt(b));
      if (ys.length > 0) {
        const y = path.basename(ys[0], '.png');
        return { z, x, y };
      }
    }
  }
  return null;
}

// Prefer the new viirs tiles directory; fallback to older tiles if needed
const viirsDir = path.join(__dirname, 'tiles_viirs');
const legacyDir = path.join(__dirname, 'tiles');
let picked = findAnyPngUnder(viirsDir);
let routeBase = '/tiles_viirs';
if (!picked) {
  picked = findAnyPngUnder(legacyDir);
  routeBase = '/tiles';
}

if (!picked) {
  console.error('No tiles found in tiles_viirs/ or tiles/. Please generate tiles first.');
  process.exit(1);
}

const { z, x, y } = picked;
const urlPath = `${routeBase}/${z}/${x}/${y}.png`;
console.log('Requesting tile:', urlPath);

// Test if the tile server is running and serving tiles
const options = {
  hostname: 'localhost',
  port: 3000,
  path: urlPath,
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  if (res.statusCode === 200) {
    console.log('Tile server responded with 200. Saving tile as test-tile.png...');
    const fileStream = fs.createWriteStream('test-tile.png');
    res.pipe(fileStream);
    fileStream.on('finish', () => {
      console.log('Test tile saved as test-tile.png');
    });
  } else {
    console.log('Tile server returned a non-200 status');
  }
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
