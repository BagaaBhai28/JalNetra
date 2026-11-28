const tileSize = 256;

// Bengaluru map extent
export const bengaluruExtent = [
  { latitude: 13.269, longitude: 77.435 },
  { latitude: 12.810, longitude: 77.800 },
];

export function project(latitude, longitude, zoom) {
  latitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));

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
    latitude:
      Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) *
      180 / Math.PI,

    longitude: x / size * 360 - 180,
  };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;

  const a =
    Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) *
    Math.cos(lat2 * rad) *
    Math.sin((lon2 - lon1) * rad / 2) ** 2;

  return 12742000 * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function nearestZone(lake, { latitude, longitude, accuracy }) {
  if (
    !lake.center ||
    ![latitude, longitude, accuracy].every(Number.isFinite) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    accuracy < 0 ||
    accuracy > 150 ||
    distanceMeters(latitude, longitude, ...lake.center) > lake.gpsRadius
  ) {
    return null;
  }

  let nearest = null;
  let best = Infinity;

  for (const zone of lake.zones) {
    const distance = distanceMeters(
      latitude,
      longitude,
      zone.latitude,
      zone.longitude
    );

    if (distance < best) {
      nearest = zone;
      best = distance;
    }
  }

  return nearest;
}

export function fitMap(points, width, height, maxZoom, padding = 44) {
  const positions = points.map(({ latitude, longitude }) =>
    project(latitude, longitude, 0)
  );

  const xs = positions.map(point => point.x);
  const ys = positions.map(point => point.y);

  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const north = Math.min(...ys);
  const south = Math.max(...ys);

  const fraction = Math.min(
    Math.max(1, width - padding * 2) / Math.max(1, east - west),
    Math.max(1, height - padding * 2) / Math.max(1, south - north)
  );

  const zoom = Math.max(
    0,
    Math.min(maxZoom, Math.floor(Math.log2(fraction)))
  );

  const scale = 2 ** zoom;

  return {
    zoom,
    width,
    height,
    left: Math.round((west + east) / 2 * scale - width / 2),
    top: Math.round((north + south) / 2 * scale - height / 2),
  };
}

/* ==========================================
   MAP TILE RENDERING
========================================== */

function drawTiles(layer, { left, top, zoom, width, height }, tileStyle = "street") {
  const firstX = Math.floor(left / tileSize);
  const firstY = Math.floor(top / tileSize);
  const lastX = Math.floor((left + width - 1) / tileSize);
  const lastY = Math.floor((top + height - 1) / tileSize);

  const reusable = new Map(
    [...layer.children].map(tile => [tile.dataset.tile, tile])
  );

  const visible = new Set();
  const world = 2 ** zoom;

  for (let x = firstX; x <= lastX; x++) {
    for (let y = firstY; y <= lastY; y++) {
      if (y < 0 || y >= world) continue;

      const wrappedX = ((x % world + world) % world);
      const sources = tileStyle === "street"
        ? [{ name: "street", url: "https://tile.openstreetmap.org/" + zoom + "/" + wrappedX + "/" + y + ".png" }]
        : tileStyle === "hybrid"
          ? [
              { name: "imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + zoom + "/" + y + "/" + wrappedX },
              { name: "roads", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/" + zoom + "/" + y + "/" + wrappedX },
              { name: "labels", url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/" + zoom + "/" + y + "/" + wrappedX },
            ]
          : [{ name: "imagery", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/" + zoom + "/" + y + "/" + wrappedX }];

      for (const source of sources) {
        const key = tileStyle + "/" + source.name + "/" + zoom + "/" + x + "/" + y;
        visible.add(key);

        let tile = reusable.get(key);

        if (!tile) {
          tile = new Image(tileSize, tileSize);
          tile.alt = "";
          tile.dataset.tile = key;
          tile.dataset.tileState = "loading";
          tile.className = source.name === "imagery" ? "" : "map-tile-labels";
          tile.draggable = false;
          tile.addEventListener("load", () => {
            tile.dataset.tileState = "loaded";
            updateTileStatus(layer);
          });
          tile.addEventListener("error", () => {
            tile.dataset.tileState = "error";
            updateTileStatus(layer);
          });
          tile.src = source.url;
          layer.append(tile);
        }

        tile.style.left = (x * tileSize - left) + "px";
        tile.style.top = (y * tileSize - top) + "px";
      }
    }
  }

  for (const [key, tile] of reusable) {
    if (!visible.has(key)) tile.remove();
  }

  updateTileStatus(layer);
}

function updateTileStatus(layer) {
  const status = document.querySelector("#city-map-status");
  if (!status || layer.id !== "city-map-tiles") return;

  const tiles = [...layer.children];
  const errors = tiles.filter(tile => tile.dataset.tileState === "error").length;
  const loading = tiles.some(tile => tile.dataset.tileState === "loading");
  status.dataset.state = errors ? "error" : loading ? "loading" : "ready";
  status.textContent = errors
    ? "Some map tiles could not load. Check your connection or switch map style."
    : loading
      ? "Loading map tiles…"
      : tiles.length
        ? "Map tiles loaded"
        : "Map tiles are not available at this view.";
}

/* ==========================================
   MAP DRAWING
========================================== */

export function drawMap(
  container,
  layer,
  points,
  markers,
  maxZoom,
  padding
) {
  const { width, height } = container.getBoundingClientRect();

  if (!width || !height || !points.length) return null;

  const viewport = fitMap(
    points,
    width,
    height,
    maxZoom,
    padding
  );

  renderViewport(layer, points, markers, viewport);

  return viewport;
}

export function renderViewport(layer, points, markers, viewport, tileStyle = "street") {
  drawTiles(layer, viewport, tileStyle);
  placeMarkers(points, markers, viewport);
}

/* ==========================================
   SELECTED LAKE MARKER FILTER
========================================== */

export function placeMarkers(points, markers, viewport) {
  const indexed = new Map(
    points.map(point => [String(point.id), point])
  );

  for (const marker of markers.children) {
    const point = indexed.get(String(marker.dataset.mapId));

    marker.hidden = !point;
    marker.style.display = point ? "" : "none";

    if (!point) {
      marker.removeAttribute("data-offscreen");
      continue;
    }

    const location = project(
      point.latitude,
      point.longitude,
      viewport.zoom
    );

    const x = location.x - viewport.left;
    const y = location.y - viewport.top;

    marker.style.left = x + "px";
    marker.style.top = y + "px";

    marker.toggleAttribute(
      "data-offscreen",
      x < 12 ||
      y < 20 ||
      x > viewport.width - 12 ||
      y > viewport.height - 12
    );
  }
}

/* ==========================================
   ZOOM
========================================== */

export function zoomViewport(
  viewport,
  zoom,
  x,
  y,
  nextX = x,
  nextY = y
) {
  const scale = 2 ** (zoom - viewport.zoom);

  return {
    ...viewport,
    zoom,
    left: (viewport.left + x) * scale - nextX,
    top: (viewport.top + y) * scale - nextY,
  };
}

/* ==========================================
   INTERACTIVE MAP ENGINE
========================================== */

export function interactiveMap(surface, render, pick) {
  const pointers = new Map();

  let viewport;
  let fitted = true;
  let fitTarget;
  let dragged = false;
  let frame;
  let wheelTime = -Infinity;
  let tileStyle = "street";

  const minZoom = 9;
  const maxZoom = 19;

  const clampZoom = zoom =>
    Math.min(maxZoom, Math.max(minZoom, zoom));

  function draw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = undefined;

      if (viewport) render(viewport, tileStyle);
    });
  }

  function fit(points = bengaluruExtent, shoreline = false) {
    const { clientWidth: width, clientHeight: height } = surface;

    if (!width || !height || !points?.length) return;

    viewport = fitMap(
      points,
      width,
      height,
      shoreline ? 18 : 13,
      shoreline ? 44 : 32
    );

    fitTarget = [points, shoreline];
    fitted = true;

    draw();
  }

  /* ==========================================
     FOCUS ON A SELECTED SECTOR
  ========================================== */

 function focusPoint(point, zoom = viewport?.zoom) {
  if (
    !viewport ||
    !point ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude)
  ) {
    return;
  }

  // Zoom in enough to make the selected sector clearly visible.
  const nextZoom = clampZoom(
    Math.max(
      Number.isFinite(zoom) ? zoom : viewport.zoom,
      16
    )
  );

  const location = project(
    point.latitude,
    point.longitude,
    nextZoom
  );

  viewport = {
    ...viewport,
    zoom: nextZoom,
    left: location.x - viewport.width / 2,
    top: location.y - viewport.height / 2,
  };

  fitted = false;
  draw();
}

  /* ==========================================
     ZOOM
  ========================================== */

  function zoomBy(
    amount,
    x,
    y
  ) {
    if (!viewport) return;

    const zoom = clampZoom(viewport.zoom + amount);

    if (zoom === viewport.zoom) return;

    const centerX = x ?? viewport.width / 2;
    const centerY = y ?? viewport.height / 2;

    viewport = zoomViewport(
      viewport,
      zoom,
      centerX,
      centerY
    );

    fitted = false;
    draw();
  }

  /* ==========================================
     PAN
  ========================================== */

  function pan(dx, dy) {
    if (!viewport) return;

    viewport.left -= dx;
    viewport.top -= dy;

    fitted = false;
    draw();
  }

  /* ==========================================
     COMPASS DIRECTIONS
  ========================================== */

  function panDirection(direction, distance = 140) {
    const movements = {
      north: [0, distance],
      south: [0, -distance],
      east: [-distance, 0],
      west: [distance, 0],
    };

    const movement = movements[String(direction).toLowerCase()];

    if (!movement) return false;

    pan(movement[0], movement[1]);

    return true;
  }

  /* ==========================================
     POINTER HELPERS
  ========================================== */

  function relative(x, y) {
    const rect = surface.getBoundingClientRect();

    return {
      x: x - rect.left,
      y: y - rect.top,
    };
  }

  function gesture() {
    const [a, b] = pointers.values();

    return b
      ? {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          span: Math.hypot(a.x - b.x, a.y - b.y),
        }
      : a;
  }

  let pinchSpan;

  /* ==========================================
     DRAG AND TOUCH
  ========================================== */

  surface.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button, a")) {
      return;
    }

    if (pointers.size === 0) dragged = false;

    pointers.set(
      event.pointerId,
      relative(event.clientX, event.clientY)
    );

    if (pointers.size === 2) {
      dragged = true;
      pinchSpan = gesture().span;
    }

    surface.setPointerCapture(event.pointerId);
  });

  surface.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;

    const before = gesture();
    const point = relative(event.clientX, event.clientY);

    if (
      !dragged &&
      Math.hypot(point.x - before.x, point.y - before.y) < 5
    ) {
      return;
    }

    pointers.set(event.pointerId, point);

    const after = gesture();

    dragged = true;
    surface.classList.add("is-dragging");

    if (pointers.size > 1 && pinchSpan > 0 && after.span > 0) {
      const steps = Math.log2(after.span / pinchSpan);

      if (Math.abs(steps) >= 0.65) {
        const zoom = clampZoom(
          viewport.zoom + Math.sign(steps)
        );

        viewport = zoomViewport(
          viewport,
          zoom,
          before.x,
          before.y,
          after.x,
          after.y
        );

        pinchSpan = after.span;
        fitted = false;

        draw();
        return;
      }
    }

    pan(
      after.x - before.x,
      after.y - before.y
    );
  });

  /* ==========================================
     POINTER CLEANUP
  ========================================== */

  for (const type of [
    "pointerup",
    "pointercancel",
    "lostpointercapture"
  ]) {
    surface.addEventListener(type, event => {
      if (!pointers.delete(event.pointerId)) return;

      if (pointers.size < 2) {
        pinchSpan = undefined;
      }

      if (!pointers.size) {
        surface.classList.remove("is-dragging");

        if (type === "pointerup" && !dragged && viewport) {
          const point = relative(
            event.clientX,
            event.clientY
          );

          pick(viewport, point.x, point.y);
        }

        dragged = false;
      }
    });
  }

  /* ==========================================
     SCROLL ZOOM
  ========================================== */

  surface.addEventListener("wheel", event => {
    event.preventDefault();

    if (
      performance.now() - wheelTime < 115 ||
      !event.deltaY
    ) {
      return;
    }

    wheelTime = performance.now();

    const point = relative(
      event.clientX,
      event.clientY
    );

    zoomBy(
      event.deltaY < 0 ? 1 : -1,
      point.x,
      point.y
    );
  }, { passive: false });

  /* ==========================================
     DOUBLE CLICK ZOOM
  ========================================== */

  surface.addEventListener("dblclick", event => {
    if (!event.target.closest("button, a")) {
      const point = relative(
        event.clientX,
        event.clientY
      );

      zoomBy(1, point.x, point.y);
    }
  });

  /* ==========================================
     KEYBOARD CONTROLS
  ========================================== */

  surface.addEventListener("keydown", event => {
    if (event.target !== surface) return;

    const movements = {
      ArrowUp: [0, 90],
      ArrowDown: [0, -90],
      ArrowLeft: [90, 0],
      ArrowRight: [-90, 0],
    };

    if (movements[event.key]) {
      pan(...movements[event.key]);
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(1);
    } else if (event.key === "-") {
      zoomBy(-1);
    } else if (event.key === "Home") {
      if (fitTarget) fit(...fitTarget);
    } else {
      return;
    }

    event.preventDefault();
  });

  /* ==========================================
     INITIAL MAP
  ========================================== */

  fit();

  /* ==========================================
     RESPONSIVE RESIZE
  ========================================== */

  new ResizeObserver(() => {
    if (!viewport) return;

    if (fitted) {
      fit(...fitTarget);
    } else {
      const { clientWidth: width, clientHeight: height } = surface;

      if (!width || !height) return;

      viewport.left += (viewport.width - width) / 2;
      viewport.top += (viewport.height - height) / 2;

      Object.assign(viewport, {
        width,
        height
      });

      draw();
    }
  }).observe(surface);

  /* ==========================================
     PUBLIC MAP API
  ========================================== */

  return {
    fit,
    focusPoint,
    zoomBy,
    pan,
    panDirection,
    getViewport: () =>
      viewport ? { ...viewport } : null,
    redraw: draw,
    setTileStyle(style) {
      tileStyle = ["street", "satellite", "hybrid"].includes(style) ? style : "street";
      draw();
      return tileStyle;
    },
    getTileStyle: () => tileStyle,
  };
}

/* ==========================================
   LAKE SHORE ZONE DETECTION
========================================== */

export function sectorAt(lake, viewport, x, y) {
  if (!viewport) return null;

  const position = unproject(
    viewport.left + x,
    viewport.top + y,
    viewport.zoom
  );

  const zone = nearestZone(lake, {
    ...position,
    accuracy: 0
  });

  if (
    !zone ||
    distanceMeters(
      position.latitude,
      position.longitude,
      zone.latitude,
      zone.longitude
    ) > (lake.shorePickRadius ?? 240)
  ) {
    return null;
  }

  return zone;
}
