const GeoTIFF = require('geotiff');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const proj4 = require('proj4');

// Configuration
const INPUT_FILE = path.join(__dirname, 'viirs_2024.tif');
const OUTPUT_DIR = path.join(__dirname, 'tiles_viirs');
// Default zoom range; can be overridden by CLI args or environment variables
const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 8;

// Parse simple CLI args like --minZoom 0 --maxZoom 6 or --minZoom=0 --maxZoom=6
function parseArgs(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (typeof a === 'string' && a.startsWith('--')) {
            const [k, v] = a.split('=');
            const key = k.replace(/^--/, '');
            if (v !== undefined) {
                out[key] = v;
            } else {
                const next = args[i + 1];
                if (next !== undefined && !String(next).startsWith('--')) {
                    out[key] = next;
                    i++;
                } else {
                    out[key] = true;
                }
            }
        }
    }
    return out;
}

const argv = parseArgs(process.argv.slice(2));
function toInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
}
let MIN_ZOOM = toInt(argv.minZoom) ?? toInt(process.env.MIN_ZOOM) ?? DEFAULT_MIN_ZOOM;
let MAX_ZOOM = toInt(argv.maxZoom) ?? toInt(process.env.MAX_ZOOM) ?? DEFAULT_MAX_ZOOM;
const SKIP_EXISTING = (String(argv.skipExisting ?? process.env.SKIP_EXISTING ?? '0').toLowerCase() === '1' ||
                       String(argv.skipExisting ?? process.env.SKIP_EXISTING ?? 'false').toLowerCase() === 'true');
const SKIP_EMPTY = (String(argv.skipEmpty ?? process.env.SKIP_EMPTY ?? '1').toLowerCase() === '1' ||
                    String(argv.skipEmpty ?? process.env.SKIP_EMPTY ?? 'true').toLowerCase() === 'true');
// Clamp and normalize
MIN_ZOOM = Math.max(0, Math.min(22, MIN_ZOOM));
MAX_ZOOM = Math.max(0, Math.min(22, MAX_ZOOM));
if (MIN_ZOOM > MAX_ZOOM) {
    const tmp = MIN_ZOOM;
    MIN_ZOOM = MAX_ZOOM;
    MAX_ZOOM = tmp;
}
console.log(`Using zoom range: ${MIN_ZOOM}..${MAX_ZOOM} (skipExisting=${SKIP_EXISTING}, skipEmpty=${SKIP_EMPTY})`);

// Web Mercator projection (EPSG:3857) and WGS84 (EPSG:4326)
const wgs84 = '+proj=longlat +datum=WGS84 +no_defs';
const mercator = '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs';

// Create tiles directory if it doesn't exist
async function createTilesDirectory() {
    try {
        await fs.access(OUTPUT_DIR);
    } catch (error) {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
    }
}

// Create a directory for a specific zoom level
async function createZoomDirectory(zoom) {
    const zoomDir = path.join(OUTPUT_DIR, zoom.toString());
    try {
        await fs.access(zoomDir);
    } catch (error) {
        await fs.mkdir(zoomDir, { recursive: true });
    }
}

// Create a directory for a specific x coordinate
async function createXDirectory(zoom, x) {
    const xDir = path.join(OUTPUT_DIR, zoom.toString(), x.toString());
    try {
        await fs.access(xDir);
    } catch (error) {
        await fs.mkdir(xDir, { recursive: true });
    }
}

// Convert lat/lon to tile coordinates
function latLonToTile(lat, lon, zoom) {
    // Validate inputs
    if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) {
        console.error('Invalid input to latLonToTile:', { lat, lon, zoom });
        return { x: 0, y: 0 };
    }
    
    // Clamp latitude to valid range to avoid infinity
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    
    const latRad = clampedLat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const xTile = Math.floor((lon + 180) / 360 * n);
    
    // Calculate y tile with proper handling for edge cases
    const latFactor = Math.log(Math.tan(latRad) + (1 / Math.cos(latRad)));
    let yTile;
    
    if (isNaN(latFactor) || !isFinite(latFactor)) {
        // Handle edge cases
        yTile = lat > 0 ? 0 : n - 1;
    } else {
        yTile = Math.floor((1 - latFactor / Math.PI) / 2 * n);
    }
    
    // Ensure tile coordinates are within valid bounds
    const maxTile = n - 1;
    const clampedXTile = Math.max(0, Math.min(maxTile, xTile));
    const clampedYTile = Math.max(0, Math.min(maxTile, yTile));
    
    return { x: clampedXTile, y: clampedYTile };
}

// Convert tile coordinates to bounding box in lat/lon
function tileToBoundingBox(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lonWest = x / n * 360 - 180;
    const latNorth = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    const lonEast = (x + 1) / n * 360 - 180;
    const latSouth = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    
    return {
        north: latNorth,
        south: latSouth,
        east: lonEast,
        west: lonWest
    };
}

// Get image value at a specific pixel
function getPixelValue(data, width, x, y, bands) {
    if (x < 0 || x >= width || y < 0 || y >= data.length / (width * bands)) {
        return 0; // Return 0 for out of bounds
    }
    
    const index = (y * width + x) * bands;
    // For light pollution, we typically only need the first band
    return data[index];
}

// VIIRS‑like color scale (data‑driven): green -> yellow -> orange -> red -> white
// We'll compute quantile-based breaks from the image data (ignoring zeros)
let COLOR_SCALE = null; // { breaks: number[], colors: {r,g,b,alpha}[] }

function buildColorScaleFromData(data) {
    try {
        const len = data.length;
        const targetSamples = Math.min(500000, Math.floor(len * 0.02)); // up to 2% or 500k
        const step = Math.max(1, Math.floor(len / Math.max(1, targetSamples)));
        const samples = [];
        for (let i = 0; i < len; i += step) {
            const v = data[i];
            if (v > 0 && Number.isFinite(v)) samples.push(v);
        }
        if (samples.length === 0) return null;
        samples.sort((a, b) => a - b);
        const q = (p) => samples[Math.min(samples.length - 1, Math.max(0, Math.floor(p * (samples.length - 1))))];
        // Breaks roughly tuned for heavy‑tailed radiance distributions
        const breaks = [q(0.20), q(0.40), q(0.60), q(0.80), q(0.90), q(0.98)];
        const colors = [
            { r: 0,   g: 80,  b: 0,   alpha: 0.35 }, // very low -> dark green
            { r: 0,   g: 160, b: 0,   alpha: 0.45 }, // low -> green
            { r: 180, g: 220, b: 0,   alpha: 0.55 }, // midlow -> yellow‑green
            { r: 255, g: 215, b: 0,   alpha: 0.68 }, // mid -> golden yellow
            { r: 255, g: 140, b: 0,   alpha: 0.80 }, // high -> orange
            { r: 255, g: 0,   b: 0,   alpha: 0.90 }, // very high -> red
            { r: 255, g: 255, b: 255, alpha: 0.95 }  // extreme -> white highlight
        ];
        return { breaks, colors };
    } catch (e) {
        console.warn('Failed to build color scale from data, using fallback:', e);
        return null;
    }
}

// Map light pollution value to color
function valueToColor(value) {
    // Treat zero/negative and very small values as no data -> fully transparent
    if (value === undefined || value === null || value <= 0 || !Number.isFinite(value)) {
        return { r: 0, g: 0, b: 0, alpha: 0 };
    }
    if (COLOR_SCALE && COLOR_SCALE.breaks && COLOR_SCALE.colors) {
        const { breaks, colors } = COLOR_SCALE; // colors length = breaks + 1
        let idx = 0;
        while (idx < breaks.length && value > breaks[idx]) idx++;
        return colors[Math.min(idx, colors.length - 1)];
    }
    // Fallback (should rarely happen): simple green->red gradient
    const n = Math.max(0, Math.min(1, value / 1000));
    const r = Math.floor(255 * n);
    const g = Math.floor(255 * (1 - n));
    const b = 0;
    const alpha = 0.3 + 0.6 * n;
    return { r, g, b, alpha };
}

// Calculate tile bounds based on image bounding box
function calculateTileBounds(imageBBox, zoom, geoKeys) {
    // Validate bounding box
    if (!imageBBox || imageBBox.length < 4) {
        console.error('Invalid bounding box:', imageBBox);
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    // Determine CRS from geoKeys
    const projectedEPSG = geoKeys && (geoKeys.ProjectedCSTypeGeoKey || geoKeys.ProjectedCRSGeoKey);
    const geographicEPSG = geoKeys && geoKeys.GeographicTypeGeoKey;
    const isProjected3857 = projectedEPSG === 3857;
    const isGeographic4326 = geographicEPSG === 4326 || (!projectedEPSG && !geographicEPSG);

    let minLon, minLat, maxLon, maxLat;
    if (isProjected3857) {
        // Image bbox is in Web Mercator meters, convert to WGS84 degrees using explicit formulas
        // Avoid wrap anomalies near ±20037508m -> ±180°
        const R = 6378137;
        const rad2deg = 180 / Math.PI;
        const minX_m = imageBBox[0];
        const minY_m = imageBBox[1];
        const maxX_m = imageBBox[2];
        const maxY_m = imageBBox[3];

        // Inverse Mercator
        const lonFromX = (x) => Math.max(-180, Math.min(180, (x / R) * rad2deg));
        const latFromY = (y) => {
            const latRad = 2 * Math.atan(Math.exp(y / R)) - Math.PI / 2;
            // Clamp to Web Mercator valid latitude
            const latDeg = latRad * rad2deg;
            return Math.max(-85.05112878, Math.min(85.05112878, latDeg));
        };

        minLon = lonFromX(minX_m);
        maxLon = lonFromX(maxX_m);
        minLat = latFromY(minY_m);
        maxLat = latFromY(maxY_m);

        // Handle antimeridian wrap: if both longitudes are near +180 or order is inverted, widen to full span
        if (Math.abs(minLon - 180) < 0.01 && Math.abs(maxLon - 180) < 0.01) {
            minLon = -180;
            maxLon = 180;
        }
        if (minLon > maxLon) {
            // Assume bbox spans across the dateline; for tiling, use full range
            minLon = -180;
            maxLon = 180;
        }

        console.log(`Image bbox interpreted as meters -> degrees (fixed): [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`);
    } else {
        // Assume bbox already in degrees (WGS84)
        minLon = imageBBox[0];
        minLat = imageBBox[1];
        maxLon = imageBBox[2];
        maxLat = imageBBox[3];

        // Normalize latitudes to Web Mercator valid range
        minLat = Math.max(-85.05112878, Math.min(85.05112878, minLat));
        maxLat = Math.max(-85.05112878, Math.min(85.05112878, maxLat));

        // Normalize longitudes to [-180, 180]
        const normalizeLon = (lon) => {
            let l = lon;
            while (l > 180) l -= 360;
            while (l < -180) l += 360;
            return l;
        };
        minLon = normalizeLon(minLon);
        maxLon = normalizeLon(maxLon);

        // Handle antimeridian wrap or collapsed span near ±180°
        const lonSpan = Math.abs(maxLon - minLon);
        const latSpan = Math.abs(maxLat - minLat);

        // If min > max, it crosses the dateline -> use full longitudinal span
        if (minLon > maxLon) {
            minLon = -180;
            maxLon = 180;
        }

        // If longitude span is suspiciously tiny while latitude span is large, widen to world
        if (lonSpan < 1 && latSpan > 10) {
            minLon = -180;
            maxLon = 180;
        }

        // If both are very close to +180 or -180, widen to full world
        if ((Math.abs(minLon - 180) < 0.01 && Math.abs(maxLon - 180) < 0.01) ||
            (Math.abs(minLon + 180) < 0.01 && Math.abs(maxLon + 180) < 0.01)) {
            minLon = -180;
            maxLon = 180;
        }

        console.log(`Image bbox interpreted as degrees (normalized): [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`);
    }
    
    // Convert to tile coordinates in Web Mercator tiling scheme
    const sw = latLonToTile(minLat, minLon, zoom); // Southwest corner
    const ne = latLonToTile(maxLat, maxLon, zoom); // Northeast corner
    
    console.log(`Tile coordinates SW: (${sw.x}, ${sw.y}), NE: (${ne.x}, ${ne.y})`);
    
    // Validate tile coordinates
    if (isNaN(sw.x) || isNaN(sw.y) || isNaN(ne.x) || isNaN(ne.y)) {
        console.error('Invalid tile coordinates calculated');
        return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    
    // Calculate bounds ensuring valid ranges
    let minX = Math.max(0, Math.min(sw.x, ne.x));
    let maxX = Math.max(sw.x, ne.x);
    const minY = Math.max(0, Math.min(sw.y, ne.y));
    const maxY = Math.max(sw.y, ne.y);

    // If X span is extremely small at higher zooms yet latitude span is large, expand to full X range
    const totalXTiles = Math.pow(2, zoom);
    if ((maxX - minX) < Math.max(1, totalXTiles / 64) && (Math.abs(maxLat - minLat) > 10)) {
        minX = 0;
        maxX = totalXTiles - 1;
    }

    console.log(`Tile bounds: minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY}`);
    
    return { minX, maxX, maxY, minY };
}

// Generate a tile from the raw image data
async function generateTileFromData(image, data, width, height, imageBBox, zoom, x, y, geoKeys) {
    try {
        // Create directory structure
        await createXDirectory(zoom, x);
        // Determine output path early and skip if requested
        const tilePath = path.join(OUTPUT_DIR, zoom.toString(), x.toString(), `${y}.png`);
        if (SKIP_EXISTING) {
            try {
                await fs.access(tilePath);
                // Exists -> skip
                return;
            } catch (_) {
                // Not exists -> proceed
            }
        }
        
        // Get bounding box for this tile
        const tileBBox = tileToBoundingBox(x, y, zoom);
        
        // Create a 256x256 tile
        const tileData = new Uint8ClampedArray(256 * 256 * 4);
        let anyOpaque = false;
        
        // For each pixel in the tile
        for (let tileY = 0; tileY < 256; tileY++) {
            for (let tileX = 0; tileX < 256; tileX++) {
                // Calculate lat/lon for this pixel
                const lat = tileBBox.north - (tileY / 256) * (tileBBox.north - tileBBox.south);
                const lon = tileBBox.west + (tileX / 256) * (tileBBox.east - tileBBox.west);
                
                // Determine CRS mapping based on geoKeys
                const projectedEPSG = geoKeys && (geoKeys.ProjectedCSTypeGeoKey || geoKeys.ProjectedCRSGeoKey);
                const geographicEPSG = geoKeys && geoKeys.GeographicTypeGeoKey;
                const isProjected3857 = projectedEPSG === 3857;
                const isGeographic4326 = geographicEPSG === 4326 || (!projectedEPSG && !geographicEPSG);

                let imgX, imgY;
                if (isProjected3857) {
                    // Convert lat/lon (deg) to Web Mercator meters
                    const [mx, my] = proj4(wgs84, mercator, [lon, lat]);
                    // Map to image pixel coordinates using image bbox in meters
                    const minX_m = imageBBox[0];
                    const minY_m = imageBBox[1];
                    const maxX_m = imageBBox[2];
                    const maxY_m = imageBBox[3];
                    imgX = Math.floor(((mx - minX_m) / (maxX_m - minX_m)) * width);
                    imgY = Math.floor(((maxY_m - my) / (maxY_m - minY_m)) * height);
                } else {
                    // Assume bbox is degrees (WGS84). Map directly using degrees
                    const minLon = imageBBox[0];
                    const minLat = imageBBox[1];
                    const maxLon = imageBBox[2];
                    const maxLat = imageBBox[3];
                    imgX = Math.floor(((lon - minLon) / (maxLon - minLon)) * width);
                    imgY = Math.floor(((maxLat - lat) / (maxLat - minLat)) * height);
                }
                
                // Get pixel value from the raw data
                let value = 0;
                if (imgX >= 0 && imgX < width && imgY >= 0 && imgY < height) {
                    const index = imgY * width + imgX;
                    value = data[index] || 0;
                }
                
                // Map value to color
                const color = valueToColor(value);
                
                // Set pixel in tile
                const tileIndex = (tileY * 256 + tileX) * 4;
                tileData[tileIndex] = color.r;     // R
                tileData[tileIndex + 1] = color.g; // G
                tileData[tileIndex + 2] = color.b; // B
                const a = Math.floor(color.alpha * 255);
                tileData[tileIndex + 3] = a; // A
                if (a > 0) anyOpaque = true;
            }
        }

        // If the entire tile is fully transparent and SKIP_EMPTY is enabled, skip writing
        if (SKIP_EMPTY && !anyOpaque) {
            try {
                await fs.access(tilePath);
                await fs.unlink(tilePath); // remove stale existing tile if any
            } catch (_) {
                // no existing file, nothing to delete
            }
            // Log skip for visibility at higher zooms only to avoid log spam
            if (zoom <= 6 || (x % 64 === 0 && y % 64 === 0)) {
                console.log(`Skipped empty tile ${zoom}/${x}/${y}`);
            }
            return;
        }

        // Create tile image using sharp
        const tileBuffer = await sharp(tileData, {
            raw: {
                width: 256,
                height: 256,
                channels: 4
            }
        })
        .png()
        .toBuffer();
        
        // Save tile
        await fs.writeFile(tilePath, tileBuffer);
        
        console.log(`Generated tile ${zoom}/${x}/${y}.png`);
    } catch (error) {
        console.error(`Error generating tile ${zoom}/${x}/${y}:`, error);
    }
}

// Process the GeoTIFF file and generate tiles
async function processGeoTIFF() {
    console.log('Starting GeoTIFF processing...');
    
    try {
        // Check if input file exists
        try {
            await fs.access(INPUT_FILE);
        } catch (error) {
            console.log(`Input file ${INPUT_FILE} not found. Cannot process GeoTIFF data.`);
            return;
        }
        
        // Open the GeoTIFF file
        console.log(`Opening ${INPUT_FILE}...`);
        const tiff = await GeoTIFF.fromFile(INPUT_FILE);
        
        // Get the main image
        const image = await tiff.getImage();
        
        // Get image info
        const width = image.getWidth();
        const height = image.getHeight();
        const bbox = image.getBoundingBox();
        const geoKeys = image.getGeoKeys();
        
        console.log(`Image dimensions: ${width}x${height}`);
        console.log(`Bounding box: [${bbox.join(', ')}]`);
        console.log(`Geo keys:`, geoKeys);
        
        // Get the raw image data
        console.log('Reading image data...');
        const rawData = await image.readRasters();
        const data = rawData[0]; // First band (assuming it's the light pollution data)

        // Build a VIIRS-like color scale using quantiles from the data (ignoring zeros)
        COLOR_SCALE = buildColorScaleFromData(data) || COLOR_SCALE;
        if (COLOR_SCALE) {
            console.log('Using VIIRS-like color scale with breaks:', COLOR_SCALE.breaks.map(b => Number(b.toFixed(3))));
        } else {
            console.log('Proceeding with fallback color scale (green->red), since quantile scale was not built.');
        }
        
        // Create output directory
        await createTilesDirectory();
        
        // Generate tiles for multiple zoom levels
        for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom++) {
            console.log(`Generating tiles for zoom level ${zoom}...`);
            await createZoomDirectory(zoom);
            
            // Calculate tile bounds for this zoom level
            const tileBounds = calculateTileBounds(bbox, zoom, geoKeys);
            
            // Validate bounds
            if (tileBounds.minX === tileBounds.maxX && tileBounds.minY === tileBounds.maxY && 
                tileBounds.minX === 0 && tileBounds.minY === 0) {
                console.log(`Skipping zoom level ${zoom} due to invalid bounds`);
                continue;
            }
            
            // Ensure bounds are valid numbers
            if (isNaN(tileBounds.minX) || isNaN(tileBounds.maxX) || 
                isNaN(tileBounds.minY) || isNaN(tileBounds.maxY)) {
                console.log(`Skipping zoom level ${zoom} due to NaN bounds`);
                continue;
            }
            
            // Use full bounds (no artificial 20-tile debug limit)
            const maxX = tileBounds.maxX;
            const maxY = tileBounds.maxY;

            const estCount = (maxX - tileBounds.minX + 1) * (maxY - tileBounds.minY + 1);
            console.log(`Generating tiles from (${tileBounds.minX},${tileBounds.minY}) to (${maxX},${maxY}) — ~${estCount} tiles`);
            
            // Check if we have valid ranges
            if (tileBounds.minX > maxX || tileBounds.minY > maxY) {
                console.log(`Skipping zoom level ${zoom} due to invalid tile ranges`);
                continue;
            }
            
            // Generate tiles within bounds
            let tileCount = 0;
            for (let x = tileBounds.minX; x <= maxX; x++) {
                for (let y = tileBounds.minY; y <= maxY; y++) {
                    await generateTileFromData(image, data, width, height, bbox, zoom, x, y, geoKeys);
                    tileCount++;
                    
                    // Progress reporting
                    if (tileCount % 50 === 0) {
                        console.log(`Generated ${tileCount}/${estCount} tiles for zoom level ${zoom}`);
                    }
                }
            }
            console.log(`Completed generation of ${tileCount} tiles for zoom level ${zoom}`);
        }
        
        console.log('GeoTIFF processing completed.');
        
        // Close the TIFF file
        await tiff.close();
        
    } catch (error) {
        console.error('Error processing GeoTIFF:', error);
    }
}

// Run the processing if this script is executed directly
if (require.main === module) {
    processGeoTIFF();
}

module.exports = { processGeoTIFF };
