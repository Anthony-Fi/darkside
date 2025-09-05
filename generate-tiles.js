const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const fsSync = require('fs'); // For sync operations

// Configuration
const INPUT_FILE = path.join(__dirname, 'viirs_2024.tif');
const OUTPUT_DIR = path.join(__dirname, 'tiles');
const MAX_ZOOM = 6; // Limiting zoom levels for performance

// Create tiles directory if it doesn't exist
async function createTilesDirectory() {
    try {
        await fs.access(OUTPUT_DIR);
    } catch (error) {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
    }
}

// Get tile coordinates for a given zoom level
function getTileRange(zoom) {
    const maxTile = Math.pow(2, zoom) - 1;
    return {
        min: 0,
        max: maxTile
    };
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

// Generate a tile with appropriate color based on location
async function generateTile(zoom, x, y) {
    // Create directory structure
    await createXDirectory(zoom, x);
    
    // Generate color based on position (for demonstration)
    const red = Math.floor((x / Math.pow(2, zoom)) * 255);
    const green = Math.floor((y / Math.pow(2, zoom)) * 255);
    const blue = Math.floor(((x + y) / (2 * Math.pow(2, zoom))) * 255);
    
    // Create tile image
    const tileBuffer = await sharp({
        create: {
            width: 256,
            height: 256,
            channels: 4,
            background: { r: red, g: green, b: blue, alpha: 0.7 }
        }
    })
    .png()
    .toBuffer();
    
    // Save tile
    const tilePath = path.join(OUTPUT_DIR, zoom.toString(), x.toString(), `${y}.png`);
    await fs.writeFile(tilePath, tileBuffer);
}

// Function to generate tiles from the TIFF file
async function generateTiles() {
    console.log('Starting tile generation from VIIRS TIFF file...');
    
    try {
        // Check if input file exists
        if (!fsSync.existsSync(INPUT_FILE)) {
            console.log(`Input file ${INPUT_FILE} not found. Creating placeholder tiles.`);
        } else {
            console.log(`Processing ${INPUT_FILE}`);
            console.log('Note: In a full implementation, this would use libraries like gdal or mapnik');
            console.log('to properly convert the geospatial TIFF to map tiles.');
        }
        
        // Create output directory
        await createTilesDirectory();
        
        // Generate placeholder tiles for demonstration
        console.log('Generating placeholder tiles...');
        
        // Generate tiles for each zoom level
        for (let zoom = 0; zoom <= MAX_ZOOM; zoom++) {
            console.log(`Generating tiles for zoom level ${zoom}...`);
            await createZoomDirectory(zoom);
            
            const range = getTileRange(zoom);
            
            // For demonstration, we'll only generate a subset of tiles
            const step = Math.max(1, Math.floor(range.max / 10)); // Only generate every nth tile
            
            for (let x = range.min; x <= range.max; x += step) {
                for (let y = range.min; y <= range.max; y += step) {
                    await generateTile(zoom, x, y);
                }
            }
        }
        
        console.log('Tile generation completed.');
        console.log(`Tiles saved to: ${OUTPUT_DIR}`);
        console.log('In a full implementation, this script would:');
        console.log('1. Read the geospatial TIFF file (viirs_2024.tif)');
        console.log('2. Convert it to map tiles using appropriate projections');
        console.log('3. Save tiles in a directory structure like: tiles/{z}/{x}/{y}.png');
        
    } catch (error) {
        console.error('Error generating tiles:', error);
    }
}

// Run the tile generation if this script is executed directly
if (require.main === module) {
    generateTiles();
}

module.exports = { generateTiles };
