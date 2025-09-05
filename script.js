// Initialize the map and focus on Finland on load
// Limit overall map zoom so it doesn't behave like a street map.
// Adjust maxZoom as needed (e.g., 11 ~32 m/px, 12 ~16 m/px, 13 ~8 m/px near 65°N).
// Cap zooming OUT so the view doesn't go wider than ~500 km (~300 mi) at typical desktop widths near 65°N.
// Approximate minZoom for this region: 7 (about ~500–700 km across depending on viewport width).
const map = L.map('map', { maxZoom: 12, minZoom: 7, zoomSnap: 1 });
// Finland approximate bounding box: [southWestLat, southWestLng], [northEastLat, northEastLng]
const finlandBounds = L.latLngBounds([59.5, 20.5], [70.1, 31.6]);
map.fitBounds(finlandBounds, { padding: [20, 20] });

// Dynamically cap zoom OUT so the scale bar tops out near ~500 km (~300 mi).
// This targets the Leaflet scale control length (default maxWidth = 100 px), not the viewport width.
// Tweak TARGET_KM if you want a different cap (e.g., 300 mi ≈ 482.8 km).
const TARGET_KM = 500;
const SCALE_MAX_WIDTH_PX = 100; // Leaflet scale control default
function setMinZoomForTargetScaleKm(targetKm) {
    const targetMeters = targetKm * 1000;
    // Meters-per-pixel at zoom 0 for Web Mercator
    const MPP_Z0 = 156543.03392804097;
    const latRad = map.getCenter().lat * Math.PI / 180;
    const cosLat = Math.max(0.0001, Math.cos(latRad)); // avoid div-by-zero at poles
    // scale_length_m ≈ (MPP_Z0 * cos(lat) / 2^z) * SCALE_MAX_WIDTH_PX
    // Solve for z such that scale_length_m <= targetMeters
    const zFloat = Math.log2((MPP_Z0 * cosLat * SCALE_MAX_WIDTH_PX) / targetMeters);
    const minZ = Math.ceil(zFloat);
    // Safety clamp (Leaflet typical range)
    const clamped = Math.max(0, Math.min(19, minZ));
    map.setMinZoom(clamped);
}

setMinZoomForTargetScaleKm(TARGET_KM);
map.on('resize', () => setMinZoomForTargetScaleKm(TARGET_KM));
map.on('moveend', () => setMinZoomForTargetScaleKm(TARGET_KM));

// Create a pane above base tiles for the light pollution overlay
map.createPane('lightOverlayPane');
map.getPane('lightOverlayPane').style.zIndex = 450; // above base tiles (200) and dimmer (300)

// Add OpenStreetMap tiles as base layer
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

// Add Dark Matter basemap (Carto) but do not add by default
const darkBaseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
});

// Add light pollution layer from our server (relative URL so it works behind reverse proxies like Caddy)
const lightPollutionLayer = L.tileLayer('/tiles_viirs/{z}/{x}/{y}.png?v=' + Date.now(), {
    attribution: 'Light Pollution Data: VIIRS 2024',
    minZoom: 0,
    maxZoom: 12,
    // OVERZOOM TEST: Force Leaflet to upscale z8 tiles at z9 (doubles the size without adding detail).
    // Remove this line or set to 9 to use native z9 tiles once you're done testing.
    maxNativeZoom: 8,
    tileSize: 256,
    className: 'nearest-neighbor',
    opacity: 0.7,
    zIndex: 10,
    pane: 'lightOverlayPane',
    crossOrigin: true,
    noWrap: true
});

// Add the light pollution layer to the map
lightPollutionLayer.addTo(map);

// Legacy overlay layer (uses pre-generated legacy tiles if available)
const legacyOverlayLayer = L.tileLayer('/tiles_legacy/{z}/{x}/{y}.png?v=' + Date.now(), {
    attribution: 'Legacy Overlay',
    minZoom: 0,
    maxZoom: 12,
    tileSize: 256,
    className: 'nearest-neighbor',
    opacity: 0.7,
    zIndex: 10,
    pane: 'lightOverlayPane',
    crossOrigin: true,
    // OVERZOOM TEST: match behavior with new overlay, upscale beyond z8 using parent tiles
    maxNativeZoom: 8,
    noWrap: true
});

// Debug logging for tile requests
lightPollutionLayer.on('tileload', (e) => {
    console.log('Tile loaded:', e.tile && e.tile.src ? e.tile.src : e);
});
lightPollutionLayer.on('tileerror', (e) => {
    console.warn('Tile error:', e && e.coords ? e.coords : e);
});

// Create legend for light pollution levels
function createLegend() {
    const legend = document.getElementById('legend-content');
    
    // Clear existing content
    legend.innerHTML = '';
    
    // Define light pollution levels and colors (VIIRS-like ramp)
    const levels = [
        { label: 'No data', color: '#000000' },
        { label: 'Very low', color: '#005000' },     // dark green
        { label: 'Low', color: '#00A000' },          // green
        { label: 'Moderate', color: '#B4DC00' },     // yellow-green
        { label: 'High', color: '#FFD700' },         // golden yellow
        { label: 'Very high', color: '#FFFFFF' },    // white (per request)
        { label: 'Extreme', color: '#FF0000' }       // red (white highlight used in tiles at extreme)
    ];
    
    // Create legend items
    levels.forEach(level => {
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        
        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.backgroundColor = level.color;
        
        const label = document.createElement('span');
        label.className = 'legend-label';
        label.textContent = level.label;
        
        legendItem.appendChild(colorBox);
        legendItem.appendChild(label);
        legend.appendChild(legendItem);
    });
}

// Initialize the legend
createLegend();

// Add scale control
L.control.scale({ imperial: true, metric: true }).addTo(map);

// Add geocoder (search) control
if (typeof L.Control.Geocoder !== 'undefined') {
    const geocoderControl = L.Control.geocoder({
        defaultMarkGeocode: false,
        collapsed: false,
        placeholder: 'Find a place…',
        errorMessage: 'No results found',
        position: 'topright',
        geocoder: L.Control.Geocoder.nominatim()
    })
    .on('markgeocode', function(e) {
        try {
            if (e && e.geocode) {
                const center = e.geocode.center;
                const bbox = e.geocode.bbox;
                if (bbox && bbox.getSouthWest && bbox.getNorthEast) {
                    const bounds = L.latLngBounds(bbox.getSouthWest(), bbox.getNorthEast());
                    map.fitBounds(bounds.pad(0.2));
                } else if (center) {
                    map.setView(center, Math.max(map.getZoom(), 9));
                }
            }
            // Collapse results list if available
            if (geocoderControl && typeof geocoderControl._collapse === 'function') {
                geocoderControl._collapse();
            }
        } catch (err) {
            console.warn('Geocoder handling error:', err);
        }
    })
    .addTo(map);
}

// Add layer control
const baseLayers = {
    "OpenStreetMap (Light)": osmLayer,
    "Dark Matter (Carto)": darkBaseLayer
};

const overlayLayers = {
    "Light Pollution (New)": lightPollutionLayer,
    "Light Pollution (Legacy)": legacyOverlayLayer
};

L.control.layers(baseLayers, overlayLayers).addTo(map);

// Darkness slider dims only the base tile pane via CSS filter
const darknessSlider = document.getElementById('darkness-slider');

function applyDarknessFromSlider() {
    if (!darknessSlider) return;
    const v = parseInt(darknessSlider.value, 10) || 0; // 0..85
    const brightness = Math.max(0, 1 - (v / 100)); // 1.0 no dim -> 0 fully dark
    const basePane = map.getPane('tilePane');
    if (basePane) {
        basePane.style.filter = `brightness(${brightness})`;
    }
}

if (darknessSlider) {
    darknessSlider.addEventListener('input', applyDarknessFromSlider);
    // Initialize on load to match current slider value
    applyDarknessFromSlider();
}

// Dark Mode toggle switches basemap and adjusts UI theme
const darkModeToggle = document.getElementById('dark-mode-toggle');
function applyDarkModeToggle() {
    if (!darkModeToggle) return;
    const enableDark = darkModeToggle.checked;
    // Switch base layers
    if (enableDark) {
        if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
        if (!map.hasLayer(darkBaseLayer)) map.addLayer(darkBaseLayer);
        document.body.classList.add('dark-ui');
    } else {
        if (map.hasLayer(darkBaseLayer)) map.removeLayer(darkBaseLayer);
        if (!map.hasLayer(osmLayer)) map.addLayer(osmLayer);
        document.body.classList.remove('dark-ui');
    }
}

if (darkModeToggle) {
    darkModeToggle.addEventListener('change', applyDarkModeToggle);
    // Initialize state
    applyDarkModeToggle();
}
