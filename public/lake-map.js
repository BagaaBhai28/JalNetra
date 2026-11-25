const tileSize = 256;

export function project(latitude, longitude, zoom) {
  const radians = latitude * Math.PI / 180;
  const size = tileSize * 2 ** zoom;
  return {
    x: (longitude + 180) / 360 * size,
    y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size,
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

export function drawLakeMap(container, layer, lake, markers) {
  if (!lake.center) return;
  const { width, height } = container.getBoundingClientRect();
  if (!width || !height) return;
  const zoom = width < 400 || height < 250 ? 15 : 16;
  const center = project(...lake.center, zoom);
  const left = Math.round(center.x - width / 2);
  const top = Math.round(center.y - height / 2);
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

  for (const marker of markers.children) {
    const point = lake.zones.find(zone => zone.id === marker.dataset.zoneId);
    const location = project(point.latitude, point.longitude, zoom);
    marker.style.left = (location.x - left) + 'px';
    marker.style.top = (location.y - top) + 'px';
  }
}
