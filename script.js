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

// Satellite overlay pane removed (unused)

// Create a pane for forecast overlays (e.g., Open-Meteo) above basemap and below light pollution
map.createPane('forecastOverlayPane');
map.getPane('forecastOverlayPane').style.zIndex = 420;

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
    // Allow overzooming beyond native z8 tiles
    maxNativeZoom: 8,
    tileSize: 256,
    className: 'nearest-neighbor',
    opacity: 0.6,
    zIndex: 10,
    pane: 'lightOverlayPane',
    crossOrigin: true,
    noWrap: true
});

// Add the light pollution layer to the map
lightPollutionLayer.addTo(map);

// Satellite overlay removed per user request (previously NASA GIBS VIIRS True Color)

// Current clouds via OpenWeatherMap, served through our server-side cached proxy
// The server caches each tile for 2 minutes and caps upstream zoom to z<=8
const openMeteoCloudsUrl = '/owm_clouds/{z}/{x}/{y}.png';
const openMeteoCloudsLayer = L.tileLayer(openMeteoCloudsUrl, {
    attribution: 'Current clouds: OpenWeatherMap (server‑cached)',
    tileSize: 256,
    maxZoom: 12,
    // Many forecast tile services provide native tiles up to ~z8; overzoom higher
    maxNativeZoom: 8,
    opacity: 0.85,
    zIndex: 6,
    pane: 'forecastOverlayPane',
    crossOrigin: true,
    noWrap: true
});

// Show current forecast clouds by default
openMeteoCloudsLayer.addTo(map);

// Minimal debug logging for forecast tiles to verify layer activity
openMeteoCloudsLayer.on('tileload', (e) => {
    try { console.debug('Forecast tile loaded:', e && e.coords ? e.coords : e); } catch (_) {}
});
openMeteoCloudsLayer.on('tileerror', (e) => {
    try { console.warn('Forecast tile error:', e && e.coords ? e.coords : e); } catch (_) {}
});

// (legacy overlay and extra debug logging removed)

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
    "Current Clouds (OWM cached)": openMeteoCloudsLayer,
    "Light Pollution": lightPollutionLayer
};

L.control.layers(baseLayers, overlayLayers).addTo(map);

// Opacity control for Forecast Clouds and Light Pollution overlays
// Provides sliders to adjust overlay opacities without changing layer order
const CloudOpacityControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
        const container = L.DomUtil.create('div', 'leaflet-bar cloud-opacity-control');
        // Basic styling to be readable on both light/dark basemaps
        container.style.padding = '8px';
        container.style.background = 'rgba(0,0,0,0.55)';
        container.style.backdropFilter = 'blur(2px)';
        container.style.color = '#fff';
        container.style.minWidth = '180px';
        container.style.font = '12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        container.style.userSelect = 'none';

        const title = L.DomUtil.create('div', 'cloud-opacity-title', container);
        title.textContent = 'Overlay Opacity';
        title.style.fontWeight = '600';
        title.style.marginBottom = '6px';

        function addSlider(labelText, initialFraction, onChange) {
            const wrap = L.DomUtil.create('div', 'cloud-opacity-row', container);
            wrap.style.marginBottom = '6px';

            const label = L.DomUtil.create('div', 'cloud-opacity-label', wrap);
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.justifyContent = 'space-between';
            label.style.marginBottom = '2px';
            label.textContent = labelText;

            const value = L.DomUtil.create('span', 'cloud-opacity-value', label);
            value.textContent = `(${Math.round(initialFraction * 100)}%)`;
            value.style.marginLeft = '6px';
            value.style.opacity = '0.9';

            const input = L.DomUtil.create('input', 'cloud-opacity-input', wrap);
            input.type = 'range';
            input.min = '0';
            input.max = '100';
            input.value = String(Math.round(initialFraction * 100));
            input.style.width = '100%';

            input.addEventListener('input', () => {
                const f = Math.max(0, Math.min(1, Number(input.value) / 100));
                value.textContent = `(${Math.round(f * 100)}%)`;
                try { onChange(f); } catch (e) { /* no-op */ }
            });
        }

        // Prevent map interactions when using the control
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        // Initial values reflect layer options
        const fcstInit = typeof openMeteoCloudsLayer.options.opacity === 'number' ? openMeteoCloudsLayer.options.opacity : 0.85;
        const lpInit = typeof lightPollutionLayer.options.opacity === 'number' ? lightPollutionLayer.options.opacity : 0.6;
        addSlider('Clouds', fcstInit, (f) => openMeteoCloudsLayer.setOpacity(f));
        addSlider('Light Pollution', lpInit, (f) => lightPollutionLayer.setOpacity(f));

        return container;
    }
});

// Add the opacity control to the map
new CloudOpacityControl().addTo(map);

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

// Collapsible info panel toggle with persisted state
(function initInfoPanelToggle(){
    const infoPanel = document.getElementById('info-panel');
    const infoToggle = document.getElementById('info-toggle');
    if (!infoPanel || !infoToggle) return;

    function setCollapsed(collapsed) {
        infoPanel.classList.toggle('collapsed', collapsed);
        const expanded = !collapsed;
        infoPanel.setAttribute('aria-expanded', String(expanded));
        infoToggle.setAttribute('aria-expanded', String(expanded));
        infoToggle.title = collapsed ? 'Expand panel' : 'Minimize panel';
        // Use a simple arrow glyph to indicate state
        infoToggle.lastChild && (infoToggle.lastChild.nodeType === Node.TEXT_NODE)
            ? (infoToggle.lastChild.textContent = collapsed ? '▸' : '▾')
            : null;
        const sr = infoToggle.querySelector('.visually-hidden');
        if (sr) sr.textContent = expanded ? 'Collapse info panel' : 'Expand info panel';
        try { localStorage.setItem('infoPanelCollapsed', String(collapsed)); } catch (e) {}
    }

    // Determine initial state from localStorage, else default collapsed on small screens
    let initialCollapsed = false;
    try {
        const saved = localStorage.getItem('infoPanelCollapsed');
        if (saved === 'true' || saved === 'false') {
            initialCollapsed = saved === 'true';
        } else {
            initialCollapsed = window.matchMedia('(max-width: 768px)').matches;
        }
    } catch (e) {
        initialCollapsed = window.matchMedia('(max-width: 768px)').matches;
    }

    setCollapsed(initialCollapsed);

    infoToggle.addEventListener('click', function(){
        const nowCollapsed = !infoPanel.classList.contains('collapsed');
        setCollapsed(nowCollapsed);
    });
})();
