# Light Pollution Map

A website for viewing light pollution data similar to lightpollutionmap.info, using VIIRS 2024 data.

## Project Structure

- `index.html` - Main HTML file
- `styles.css` - Styling for the map interface
- `script.js` - Client-side JavaScript for map functionality
- `server.js` - Express server for serving map tiles
- `generate-tiles.js` - Script to convert TIFF data to map tiles
- `viirs_2024.tif` - Raw VIIRS light pollution data (GeoTIFF format)
- `viirs_2024.png` - Visualization of light pollution data

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

3. Open `http://localhost:3000` in your browser

## Docker

### Build image

```bash
docker build -t aurora-night .
```

### Run with Docker (bind port 3000)

Mount tiles directories read-only so the container can serve them:

```bash
docker run --name aurora-night -p 3000:3000 \
  -v "${PWD}/tiles_viirs:/usr/src/app/tiles_viirs:ro" \
  -v "${PWD}/tiles:/usr/src/app/tiles:ro" \
  -v "${PWD}/tiles_legacy:/usr/src/app/tiles_legacy:ro" \
  -e PORT=3000 \
  -e LEGACY_TILES_DIR=/usr/src/app/tiles_legacy \
  aurora-night
```

On Windows PowerShell, replace `${PWD}` with `${PWD.Path}` or the absolute path, e.g. `g:/aurora-night`.

### Run with Docker Compose

```bash
docker compose up -d --build
```

The service exposes `http://localhost:3000`. Health check is available at `/health`.

## Git

Initialize a repository and make the first commit:

```bash
git init
git add .
git commit -m "Initial commit: Aurora Dark Sky Map"
```

Optionally set the default branch and add a remote:

```bash
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## Implementation Notes

This project is still in development. The current implementation includes:

1. A basic Leaflet map interface
2. A tile server structure
3. A placeholder for the light pollution layer

The next steps are to:

1. Convert the VIIRS TIFF data to map tiles
2. Implement the actual tile serving functionality
3. Add more advanced features like time sliders, location search, etc.

## Data Sources

- VIIRS 2024 light pollution data (viirs_2024.tif and viirs_2024.png)
