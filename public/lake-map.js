const tileSize = 256;

export function project(latitude, longitude, zoom) {
  const radians = latitude * Math.PI / 180;
  const size = tileSize * 2 ** zoom;
  return {
    x: (longitude + 180) / 360 * size,
    y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size,
  };
}

export function unproject(x, y, zoom) {
  const size = tileSize * 2 ** zoom;
  return {
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI,
    longitude: x / size * 360 - 180,
  };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function nearestZone(lake, { latitude, longitude, accuracy }) {
  if (!lake.center || ![latitude, longitude, accuracy].every(Number.isFinite) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || accuracy > 150 ||
      distanceMeters(latitude, longitude, ...lake.center) > lake.gpsRadius) return null;
  let nearest = null;
  let best = Infinity;
  for (const zone of lake.zones) {
    const distance = distanceMeters(latitude, longitude, zone.latitude, zone.longitude);
    if (distance < best) {
      nearest = zone;
      best = distance;
    }
  }
  return nearest;
}

export function fitMap(points, width, height, maxZoom, padding = 44) {
  const positions = points.map(({ latitude, longitude }) => project(latitude, longitude, 0));
  const xs = positions.map(point => point.x);
  const ys = positions.map(point => point.y);
  const west = Math.min(...xs), east = Math.max(...xs);
  const north = Math.min(...ys), south = Math.max(...ys);
  const fraction = Math.min(
    Math.max(1, width - padding * 2) / (east - west),
    Math.max(1, height - padding * 2) / (south - north),
  );
  const zoom = Math.max(0, Math.min(maxZoom, Math.floor(Math.log2(fraction))));
  const scale = 2 ** zoom;
  return {
    zoom, width, height,
    left: Math.round((west + east) / 2 * scale - width / 2),
    top: Math.round((north + south) / 2 * scale - height / 2),
  };
}

function drawTiles(layer, { left, top, zoom, width, height }) {
  const firstX = Math.floor(left / tileSize);
  const firstY = Math.floor(top / tileSize);
  const lastX = Math.floor((left + width - 1) / tileSize);
  const lastY = Math.floor((top + height - 1) / tileSize);

  const reusable = new Map([...layer.children].map(tile => [tile.dataset.tile, tile]));
  const visible = new Set();
  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      const key = zoom + '/' + x + '/' + y;
      visible.add(key);
      let tile = reusable.get(key);
      if (!tile) {
        tile = new Image(tileSize, tileSize);
        tile.alt = '';
        tile.dataset.tile = key;
        tile.src = 'https://tile.openstreetmap.org/' + key + '.png';
        layer.append(tile);
      }
      tile.style.left = (x * tileSize - left) + 'px';
      tile.style.top = (y * tileSize - top) + 'px';
    }
  }
  for (const [key, tile] of reusable) if (!visible.has(key)) tile.remove();
}

export function drawMap(container, layer, points, markers, maxZoom, padding) {
  const { width, height } = container.getBoundingClientRect();
  if (!width || !height || !points.length) return null;
  const viewport = fitMap(points, width, height, maxZoom, padding);
  drawTiles(layer, viewport);
  for (const marker of markers.children) {
    const point = points.find(item => item.id === marker.dataset.mapId);
    if (!point) continue;
    const location = project(point.latitude, point.longitude, viewport.zoom);
    marker.style.left = (location.x - viewport.left) + 'px';
    marker.style.top = (location.y - viewport.top) + 'px';
  }
  return viewport;
}

export function sectorAt(lake, viewport, x, y) {
  if (!viewport) return null;
  const position = unproject(viewport.left + x, viewport.top + y, viewport.zoom);
  const zone = nearestZone(lake, { ...position, accuracy: 0 });
  if (!zone || distanceMeters(position.latitude, position.longitude, zone.latitude, zone.longitude) >
    (lake.shorePickRadius ?? 240)) return null;
  return zone;
}
