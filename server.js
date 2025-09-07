const express = require('express');
const path = require('path');
const cors = require('cors');
const sharp = require('sharp');
const fs = require('fs');
const https = require('https');
// Load environment variables from .env if present
try { require('dotenv').config(); } catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Serve legacy tiles from an external directory if provided
// Set environment variable LEGACY_TILES_DIR to the base directory containing {z}/{x}/{y}.png
app.get('/tiles_legacy/:z/:x/:y.png', async (req, res) => {
    try {
        const { z, x, y } = req.params;
        const zoom = parseInt(z);
        const tileX = parseInt(x);
        const tileY = parseInt(y);
        if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 0 || tileX < 0 || tileY < 0) {
            return res.status(400).send('Invalid tile coordinates');
        }

        // Determine base directory: use LEGACY_TILES_DIR if exists, otherwise fallback to ./tiles
        const legacyBase = process.env.LEGACY_TILES_DIR && fs.existsSync(process.env.LEGACY_TILES_DIR)
            ? process.env.LEGACY_TILES_DIR
            : path.join(__dirname, 'tiles');

        const tilePath = path.join(legacyBase, z.toString(), x.toString(), `${tileY}.png`);
        if (fs.existsSync(tilePath)) {
            console.log(`Serving LEGACY tile: ${z}/${x}/${y} from ${legacyBase}`);
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            res.sendFile(tilePath);
        } else {
            console.log(`LEGACY tile not found: ${z}/${x}/${y} in ${legacyBase}, serving transparent placeholder`);
            const tileBuffer = await sharp({
                create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
            }).png().toBuffer();
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            res.status(200).send(tileBuffer);
        }
    } catch (error) {
        console.error('Error serving LEGACY tile:', error);
        res.status(500).send('Internal server error');
    }
});

// Serve map tiles
app.get('/tiles/:z/:x/:y.png', async (req, res) => {
    try {
        const { z, x, y } = req.params;
        
        // Validate tile coordinates
        const zoom = parseInt(z);
        const tileX = parseInt(x);
        const tileY = parseInt(y);
        
        // Basic validation
        if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || 
            zoom < 0 || zoom > 12 || 
            tileX < 0 || tileY < 0) {
            return res.status(400).send('Invalid tile coordinates');
        }
        
        // Construct the tile path
        const tilePath = path.join(__dirname, 'tiles', z.toString(), tileX.toString(), `${tileY}.png`);
        
        // Check if the tile exists
        if (fs.existsSync(tilePath)) {
            // Log tile request
            console.log(`Serving tile: ${z}/${x}/${y}`);
            
            // Set appropriate headers for tile
            res.set('Content-Type', 'image/png');
            // During development, disable caching so we always see latest tiles
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            
            // Serve the actual tile
            res.sendFile(tilePath);
        } else {
            // Log missing tile
            console.log(`Tile not found: ${z}/${x}/${y}, serving transparent placeholder`);
            
            // If tile doesn't exist, generate a transparent placeholder tile
            const tileBuffer = await sharp({
                create: {
                    width: 256,
                    height: 256,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .png()
            .toBuffer();
            
            // Set appropriate headers
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            
            // Send the tile
            res.status(200).send(tileBuffer);
        }
    } catch (error) {
        console.error('Error serving tile:', error);
        res.status(500).send('Internal server error');
    }
});

// Helper function to get pollution color based on zoom level
function getPollutionColor(zoom) {
    // This is a simplified implementation
    // In a real implementation, this would be based on actual data
    const colors = [
        { r: 0, g: 0, b: 0, alpha: 0 },      // No data
        { r: 0, g: 0, b: 128, alpha: 0.7 },   // Low pollution
        { r: 0, g: 0, b: 255, alpha: 0.7 },   // Medium pollution
        { r: 0, g: 255, b: 255, alpha: 0.7 }, // High pollution
        { r: 255, g: 255, b: 0, alpha: 0.7 }, // Very high pollution
        { r: 255, g: 0, b: 0, alpha: 0.7 }    // Extreme pollution
    ];
    
    // Use zoom level to select color (just for demonstration)
    const index = Math.min(Math.floor(zoom / 2), colors.length - 1);
    const color = colors[index];
    
    return {
        r: color.r,
        g: color.g,
        b: color.b,
        alpha: color.alpha
    };
}

// Serve VIIRS tiles (new generated set)
app.get('/tiles_viirs/:z/:x/:y.png', async (req, res) => {
    try {
        const { z, x, y } = req.params;
        const zoom = parseInt(z);
        const tileX = parseInt(x);
        const tileY = parseInt(y);
        if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 0 || tileX < 0 || tileY < 0) {
            return res.status(400).send('Invalid tile coordinates');
        }
        const tilePath = path.join(__dirname, 'tiles_viirs', z.toString(), tileX.toString(), `${tileY}.png`);
        if (fs.existsSync(tilePath)) {
            console.log(`Serving VIIRS tile: ${z}/${x}/${y}`);
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            res.sendFile(tilePath);
        } else {
            console.log(`VIIRS tile not found: ${z}/${x}/${y}, serving transparent placeholder`);
            const tileBuffer = await sharp({
                create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
            }).png().toBuffer();
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            res.status(200).send(tileBuffer);
        }
    } catch (error) {
        console.error('Error serving VIIRS tile:', error);
        res.status(500).send('Internal server error');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Light pollution tile server is running',
        timestamp: new Date().toISOString()
    });
});

// -------------------------------
// OpenWeatherMap Clouds tile proxy with disk cache
// -------------------------------
// Requirements:
//  - Set environment variable OWM_API_KEY with your OpenWeatherMap key
//  - This route caches tiles for 120 seconds to minimize API usage

const OWM_TTL_SECONDS = 120; // 2 minutes
const OWM_MAX_ZOOM = 8; // hard cap to limit number of tiles
const OWM_LAYER = process.env.OWM_LAYER || 'clouds_new'; // try 'clouds' if 401

function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function makeTransparentTile() {
    return sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toBuffer();
}

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (resp) => {
            if (resp.statusCode !== 200) {
                const err = new Error(`Upstream status ${resp.statusCode}`);
                // drain to allow socket reuse
                resp.resume();
                return reject(err);
            }
            const chunks = [];
            resp.on('data', (d) => chunks.push(d));
            resp.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

app.get('/owm_clouds/:z/:x/:y.png', async (req, res) => {
    try {
        const { z, x, y } = req.params;
        const zoom = parseInt(z, 10);
        const tileX = parseInt(x, 10);
        const tileY = parseInt(y, 10);

        if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 0 || tileX < 0 || tileY < 0) {
            return res.status(400).send('Invalid tile coordinates');
        }
        if (zoom > OWM_MAX_ZOOM) {
            // Do not request upstream at high zooms (client should overzoom); return transparent
            const buf = await makeTransparentTile();
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=30');
            res.set('Access-Control-Allow-Origin', '*');
            return res.status(200).send(buf);
        }

        const apiKey = process.env.OWM_API_KEY;
        const cacheDir = path.join(__dirname, '.cache', 'owm_clouds', z.toString(), x.toString());
        const cachePath = path.join(cacheDir, `${tileY}.png`);
        const now = Date.now();

        // Try cached tile if fresh
        if (fs.existsSync(cachePath)) {
            try {
                const stat = fs.statSync(cachePath);
                const ageSec = Math.max(0, Math.floor((now - stat.mtimeMs) / 1000));
                if (ageSec <= OWM_TTL_SECONDS) {
                    res.set('Content-Type', 'image/png');
                    res.set('Cache-Control', 'public, max-age=30');
                    res.set('Access-Control-Allow-Origin', '*');
                    return res.sendFile(cachePath);
                }
            } catch (_) { /* ignore stat errors, will refetch */ }
        }

        if (!apiKey) {
            // No API key available; fall back to stale cache or transparent
            if (fs.existsSync(cachePath)) {
                res.set('Content-Type', 'image/png');
                res.set('Cache-Control', 'no-store');
                res.set('Access-Control-Allow-Origin', '*');
                return res.sendFile(cachePath);
            }
            const buf = await makeTransparentTile();
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            return res.status(200).send(buf);
        }

        const layer = OWM_LAYER;
        if (zoom === 0 && tileX === 0 && tileY === 0) {
            console.log(`[OWM] Using layer: ${layer}`);
        }
        const upstreamUrl = `https://tile.openweathermap.org/map/${layer}/${zoom}/${tileX}/${tileY}.png?appid=${apiKey}`;

        // Fetch and cache
        let tileBuf;
        try {
            tileBuf = await fetchBuffer(upstreamUrl);
        } catch (err) {
            console.warn('OWM fetch failed:', err.message);
            // Serve stale cache if available, else transparent
            if (fs.existsSync(cachePath)) {
                res.set('Content-Type', 'image/png');
                res.set('Cache-Control', 'no-store');
                res.set('Access-Control-Allow-Origin', '*');
                return res.sendFile(cachePath);
            }
            const buf = await makeTransparentTile();
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'no-store');
            res.set('Access-Control-Allow-Origin', '*');
            return res.status(200).send(buf);
        }

        ensureDirSync(cacheDir);
        try { fs.writeFileSync(cachePath, tileBuf); } catch (_) {}

        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=30');
        res.set('Access-Control-Allow-Origin', '*');
        return res.status(200).send(tileBuf);
    } catch (error) {
        console.error('Error in /owm_clouds route:', error);
        const buf = await makeTransparentTile();
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.set('Access-Control-Allow-Origin', '*');
        res.status(200).send(buf);
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Static files (after tile route so our custom headers apply to tiles)
app.use(express.static('.'));

// Handle 404 errors
app.use((req, res) => {
    res.status(404).send('Not found');
});

app.listen(PORT, () => {
    console.log(`Light pollution map server is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser to view the map`);
});
