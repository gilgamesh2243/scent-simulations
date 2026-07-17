const EARTH_RADIUS = 6371000;
const DEG = Math.PI / 180;
let rawEnvironment = null;
let environmentRasterCache = new Map();
let environmentModelCache = new Map();
let signalCache = null;
const RASTER_CACHE_LIMIT = 8;
const SPATIAL_BIN_SIZE = 96;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rand(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function signedRand(seed) {
  return rand(seed) * 2 - 1;
}

function localToLonLat(x, y, lat0, lon0) {
  const phi0 = lat0 * DEG;
  const lat = lat0 + (y / EARTH_RADIUS) / DEG;
  const lon = lon0 + (x / (EARTH_RADIUS * Math.cos(phi0))) / DEG;
  return [lon, lat];
}

function lonLatToLocal(lon, lat, lat0, lon0) {
  const phi0 = lat0 * DEG;
  const x = EARTH_RADIUS * Math.cos(phi0) * (lon - lon0) * DEG;
  const y = EARTH_RADIUS * (lat - lat0) * DEG;
  return [x, y];
}

function makeObstacles(settings) {
  const stormwater = rawEnvironment?.stormwater;
  const pointCollections = [
    stormwater?.dropInlets?.features,
    stormwater?.endStructures?.features,
    stormwater?.stormBasins?.features,
    stormwater?.manholes?.features,
    stormwater?.networkStructures?.features,
  ].flatMap((features) => features ?? []);

  return pointCollections
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates;
      const [x, y] = lonLatToLocal(lon, lat, settings.lat, settings.lon);
      return { lon, lat, type: "drainage", size: feature.properties?.kind === "basin" ? 22 : 14, x, y, index, distance: Math.hypot(x, y) };
    })
    .filter((item) => item.distance < settings.radius * 0.98)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointBounds(points) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

function ringsBounds(rings) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const ring of rings) {
    const ringBounds = pointBounds(ring);
    bounds.minX = Math.min(bounds.minX, ringBounds.minX);
    bounds.maxX = Math.max(bounds.maxX, ringBounds.maxX);
    bounds.minY = Math.min(bounds.minY, ringBounds.minY);
    bounds.maxY = Math.max(bounds.maxY, ringBounds.maxY);
  }
  return bounds;
}

function nearBounds(x, y, bounds, padding) {
  return x >= bounds.minX - padding && x <= bounds.maxX + padding && y >= bounds.minY - padding && y <= bounds.maxY + padding;
}

function binKey(x, y) {
  return `${x}:${y}`;
}

function makeSpatialIndex(items, getBounds, binSize = SPATIAL_BIN_SIZE) {
  const bins = new Map();
  for (const item of items) {
    const bounds = getBounds(item);
    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) continue;
    const minX = Math.floor(bounds.minX / binSize);
    const maxX = Math.floor(bounds.maxX / binSize);
    const minY = Math.floor(bounds.minY / binSize);
    const maxY = Math.floor(bounds.maxY / binSize);
    for (let by = minY; by <= maxY; by += 1) {
      for (let bx = minX; bx <= maxX; bx += 1) {
        const key = binKey(bx, by);
        const bin = bins.get(key);
        if (bin) bin.push(item);
        else bins.set(key, [item]);
      }
    }
  }
  return { bins, binSize };
}

function querySpatialIndex(index, x, y, padding) {
  const minX = Math.floor((x - padding) / index.binSize);
  const maxX = Math.floor((x + padding) / index.binSize);
  const minY = Math.floor((y - padding) / index.binSize);
  const maxY = Math.floor((y + padding) / index.binSize);
  const result = [];
  const seen = new Set();
  for (let by = minY; by <= maxY; by += 1) {
    for (let bx = minX; bx <= maxX; bx += 1) {
      const bin = index.bins.get(binKey(bx, by));
      if (!bin) continue;
      for (const item of bin) {
        if (seen.has(item)) continue;
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

function featureSegments(features, settings) {
  const segments = [];
  for (const feature of features ?? []) {
    if (feature.geometry?.type !== "LineString") continue;
    const path = feature.geometry.coordinates.map(([lon, lat]) => lonLatToLocal(lon, lat, settings.lat, settings.lon));
    for (let i = 1; i < path.length; i += 1) {
      segments.push([path[i - 1], path[i], feature.properties ?? {}, pointBounds([path[i - 1], path[i]])]);
    }
  }
  return segments;
}

function canopyShapes(features, settings) {
  const polygons = [];
  const segments = [];
  for (const feature of features ?? []) {
    if (feature.geometry?.type === "Polygon") {
      const rings = feature.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => lonLatToLocal(lon, lat, settings.lat, settings.lon)));
      polygons.push({ rings, properties: feature.properties ?? {}, bounds: ringsBounds(rings) });
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i += 1) segments.push([ring[i - 1], ring[i], feature.properties ?? {}, pointBounds([ring[i - 1], ring[i]])]);
      }
    }
    if (feature.geometry?.type === "LineString") {
      const path = feature.geometry.coordinates.map(([lon, lat]) => lonLatToLocal(lon, lat, settings.lat, settings.lon));
      for (let i = 1; i < path.length; i += 1) segments.push([path[i - 1], path[i], feature.properties ?? {}, pointBounds([path[i - 1], path[i]])]);
    }
  }
  return { polygons, segments };
}

function polygonShapes(features, settings) {
  const polygons = [];
  const segments = [];
  for (const feature of features ?? []) {
    if (feature.geometry?.type !== "Polygon") continue;
    const rings = feature.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => lonLatToLocal(lon, lat, settings.lat, settings.lon)));
    polygons.push({ rings, properties: feature.properties ?? {}, bounds: ringsBounds(rings) });
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i += 1) segments.push([ring[i - 1], ring[i], feature.properties ?? {}, pointBounds([ring[i - 1], ring[i]])]);
    }
  }
  return { polygons, segments };
}

function collectionFeatures(collections) {
  return collections.flatMap((collection) => collection?.features ?? []);
}

function pointShapes(features, settings) {
  return (features ?? [])
    .filter((feature) => feature.geometry?.type === "Point")
    .map((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const [x, y] = lonLatToLocal(lon, lat, settings.lat, settings.lon);
      return { x, y, bounds: { minX: x, maxX: x, minY: y, maxY: y }, properties: feature.properties ?? {} };
    });
}

function getEnvironmentModel(settings) {
  const key = `${settings.lat}:${settings.lon}:${rawEnvironment?.generatedAt ?? "env"}`;
  if (environmentModelCache.has(key)) return environmentModelCache.get(key);

  const stormwater = rawEnvironment.stormwater;
  const roadSegments = featureSegments(rawEnvironment.roads?.features, settings);
  const canopyModel = canopyShapes(rawEnvironment.canopy?.features, settings);
  const buildingModel = polygonShapes(rawEnvironment.buildings?.features, settings);
  const drainageSegments = featureSegments(collectionFeatures([stormwater?.gravityMains, stormwater?.openChannels, stormwater?.virtualMains]), settings);
  const drainagePoints = pointShapes(collectionFeatures([stormwater?.dropInlets, stormwater?.endStructures, stormwater?.manholes, stormwater?.networkStructures, stormwater?.stormBasins]), settings);
  const drainagePolygons = polygonShapes(collectionFeatures([stormwater?.stormPonds, stormwater?.stormStructures]), settings);
  const model = {
    roadIndex: makeSpatialIndex(roadSegments, (segment) => segment[3]),
    canopyPolygonIndex: makeSpatialIndex(canopyModel.polygons, (shape) => shape.bounds),
    canopySegmentIndex: makeSpatialIndex(canopyModel.segments, (segment) => segment[3]),
    buildingPolygonIndex: makeSpatialIndex(buildingModel.polygons, (shape) => shape.bounds),
    buildingSegmentIndex: makeSpatialIndex(buildingModel.segments, (segment) => segment[3]),
    drainageSegmentIndex: makeSpatialIndex(drainageSegments, (segment) => segment[3]),
    drainagePointIndex: makeSpatialIndex(drainagePoints, (point) => point.bounds),
    drainagePolygonIndex: makeSpatialIndex(drainagePolygons.polygons, (shape) => shape.bounds),
  };
  environmentModelCache.set(key, model);
  return model;
}

function setRasterCache(key, raster) {
  if (environmentRasterCache.has(key)) environmentRasterCache.delete(key);
  environmentRasterCache.set(key, raster);
  while (environmentRasterCache.size > RASTER_CACHE_LIMIT) {
    const oldest = environmentRasterCache.keys().next().value;
    environmentRasterCache.delete(oldest);
  }
}

function getEnvironmentRaster(settings, gridSize, step) {
  if (!rawEnvironment) {
    return {
      road: new Float32Array(gridSize * gridSize),
      canopy: new Float32Array(gridSize * gridSize),
      building: new Float32Array(gridSize * gridSize),
      buildingEdge: new Float32Array(gridSize * gridSize),
      drainage: new Float32Array(gridSize * gridSize),
      impervious: new Float32Array(gridSize * gridSize),
      moisture: new Float32Array(gridSize * gridSize),
      lowPoint: new Float32Array(gridSize * gridSize),
      surfaceHold: new Float32Array(gridSize * gridSize),
      avgRoad: 0,
      avgCanopy: 0,
      avgBuilding: 0,
      avgDrainage: 0,
      avgImpervious: 0,
      avgMoisture: 0,
      avgLowPoint: 0,
      avgSurfaceHold: 1,
    };
  }
  const key = `${settings.lat}:${settings.lon}:${settings.radius}:${gridSize}:${rawEnvironment.generatedAt ?? "env"}`;
  if (environmentRasterCache.has(key)) return environmentRasterCache.get(key);

  const road = new Float32Array(gridSize * gridSize);
  const canopyGrid = new Float32Array(gridSize * gridSize);
  const buildingGrid = new Float32Array(gridSize * gridSize);
  const buildingEdgeGrid = new Float32Array(gridSize * gridSize);
  const drainageGrid = new Float32Array(gridSize * gridSize);
  const imperviousGrid = new Float32Array(gridSize * gridSize);
  const moistureGrid = new Float32Array(gridSize * gridSize);
  const lowPointGrid = new Float32Array(gridSize * gridSize);
  const surfaceHoldGrid = new Float32Array(gridSize * gridSize);
  const model = getEnvironmentModel(settings);
  let roadSum = 0;
  let canopySum = 0;
  let buildingSum = 0;
  let drainageSum = 0;
  let imperviousSum = 0;
  let moistureSum = 0;
  let lowPointSum = 0;
  let surfaceHoldSum = 0;

  for (let yi = 0; yi < gridSize; yi += 1) {
    for (let xi = 0; xi < gridSize; xi += 1) {
      const idx = yi * gridSize + xi;
      const x = -settings.radius + xi * step;
      const y = -settings.radius + yi * step;
      if (Math.hypot(x, y) > settings.radius) continue;

      let minRoad = Infinity;
      for (const [[ax, ay], [bx, by], , bounds] of querySpatialIndex(model.roadIndex, x, y, 90)) {
        if (!nearBounds(x, y, bounds, 90)) continue;
        const d = distanceToSegment(x, y, ax, ay, bx, by);
        if (d < minRoad) minRoad = d;
      }
      road[idx] = Math.exp(-(minRoad * minRoad) / (2 * 22 * 22));

      let canopyValue = 0;
      for (const shape of querySpatialIndex(model.canopyPolygonIndex, x, y, 0)) {
        if (!nearBounds(x, y, shape.bounds, 0)) continue;
        if (pointInPolygon(x, y, shape.rings[0])) {
          canopyValue = 1;
          break;
        }
      }
      if (canopyValue < 1) {
        let minCanopy = Infinity;
        for (const [[ax, ay], [bx, by], , bounds] of querySpatialIndex(model.canopySegmentIndex, x, y, 160)) {
          if (!nearBounds(x, y, bounds, 160)) continue;
          const d = distanceToSegment(x, y, ax, ay, bx, by);
          if (d < minCanopy) minCanopy = d;
        }
        canopyValue = Math.exp(-(minCanopy * minCanopy) / (2 * 42 * 42));
      }
      canopyGrid[idx] = canopyValue;
      let buildingValue = 0;
      for (const shape of querySpatialIndex(model.buildingPolygonIndex, x, y, 0)) {
        if (!nearBounds(x, y, shape.bounds, 0)) continue;
        if (pointInPolygon(x, y, shape.rings[0])) {
          buildingValue = 1;
          break;
        }
      }
      let minBuildingEdge = Infinity;
      for (const [[ax, ay], [bx, by], , bounds] of querySpatialIndex(model.buildingSegmentIndex, x, y, 90)) {
        if (!nearBounds(x, y, bounds, 90)) continue;
        const d = distanceToSegment(x, y, ax, ay, bx, by);
        if (d < minBuildingEdge) minBuildingEdge = d;
      }
      buildingGrid[idx] = buildingValue;
      buildingEdgeGrid[idx] = Math.exp(-(minBuildingEdge * minBuildingEdge) / (2 * 24 * 24));

      let drainageValue = 0;
      for (const shape of querySpatialIndex(model.drainagePolygonIndex, x, y, 0)) {
        if (!nearBounds(x, y, shape.bounds, 0)) continue;
        if (pointInPolygon(x, y, shape.rings[0])) {
          drainageValue = Math.max(drainageValue, 0.86);
          break;
        }
      }
      let minDrainageLine = Infinity;
      for (const [[ax, ay], [bx, by], properties, bounds] of querySpatialIndex(model.drainageSegmentIndex, x, y, 80)) {
        if (!nearBounds(x, y, bounds, 80)) continue;
        const d = distanceToSegment(x, y, ax, ay, bx, by);
        const width = properties.kind === "channel" ? 18 : properties.kind === "virtual-pipe" ? 7 : 10;
        const value = Math.exp(-(d * d) / (2 * width * width));
        drainageValue = Math.max(drainageValue, value * (properties.kind === "channel" ? 1 : properties.kind === "virtual-pipe" ? 0.42 : 0.72));
        if (d < minDrainageLine) minDrainageLine = d;
      }
      for (const point of querySpatialIndex(model.drainagePointIndex, x, y, 80)) {
        if (Math.abs(x - point.x) > 80 || Math.abs(y - point.y) > 80) continue;
        const d = Math.hypot(x - point.x, y - point.y);
        const width = point.properties.kind === "basin" ? 22 : point.properties.kind === "outfall" ? 16 : 10;
        drainageValue = Math.max(drainageValue, Math.exp(-(d * d) / (2 * width * width)) * (point.properties.kind === "basin" ? 0.78 : 0.95));
      }
      drainageGrid[idx] = clamp(drainageValue, 0, 1);
      const impervious = clamp(buildingValue * 0.95 + road[idx] * 0.7, 0, 1);
      const lowPoint = clamp(drainageGrid[idx] * 0.78 + canopyGrid[idx] * 0.12 - road[idx] * 0.12 - buildingValue * 0.28, 0, 1);
      const moisture = clamp(drainageGrid[idx] * 0.58 + canopyGrid[idx] * 0.35 + lowPoint * 0.34 - impervious * 0.42, 0, 1);
      const surfaceHold = clamp(0.62 + canopyGrid[idx] * 0.38 + moisture * 0.32 + lowPoint * 0.24 - road[idx] * 0.34 - buildingValue * 0.52, 0.04, 1.72);
      imperviousGrid[idx] = impervious;
      moistureGrid[idx] = moisture;
      lowPointGrid[idx] = lowPoint;
      surfaceHoldGrid[idx] = surfaceHold;
      roadSum += road[idx];
      canopySum += canopyGrid[idx];
      buildingSum += buildingValue;
      drainageSum += drainageGrid[idx];
      imperviousSum += impervious;
      moistureSum += moisture;
      lowPointSum += lowPoint;
      surfaceHoldSum += surfaceHold;
    }
  }

  const raster = {
    road,
    canopy: canopyGrid,
    building: buildingGrid,
    buildingEdge: buildingEdgeGrid,
    drainage: drainageGrid,
    impervious: imperviousGrid,
    moisture: moistureGrid,
    lowPoint: lowPointGrid,
    surfaceHold: surfaceHoldGrid,
    avgRoad: roadSum / road.length,
    avgCanopy: canopySum / canopyGrid.length,
    avgBuilding: buildingSum / buildingGrid.length,
    avgDrainage: drainageSum / drainageGrid.length,
    avgImpervious: imperviousSum / imperviousGrid.length,
    avgMoisture: moistureSum / moistureGrid.length,
    avgLowPoint: lowPointSum / lowPointGrid.length,
    avgSurfaceHold: surfaceHoldSum / surfaceHoldGrid.length,
  };
  setRasterCache(key, raster);
  return raster;
}

function environmentAt(environment, gridSize, step, radius, x, y) {
  const gx = clamp(Math.round((x + radius) / step), 0, gridSize - 1);
  const gy = clamp(Math.round((y + radius) / step), 0, gridSize - 1);
  const idx = gy * gridSize + gx;
  return {
    road: environment.road[idx] || 0,
    canopy: environment.canopy[idx] || 0,
    building: environment.building[idx] || 0,
    buildingEdge: environment.buildingEdge[idx] || 0,
    drainage: environment.drainage[idx] || 0,
    impervious: environment.impervious?.[idx] || 0,
    moisture: environment.moisture?.[idx] || 0,
    lowPoint: environment.lowPoint?.[idx] || 0,
    surfaceHold: environment.surfaceHold?.[idx] || 1,
  };
}

function buildingModeCoefficients(mode) {
  if (mode === "obstruction") {
    return {
      slow: 0.68,
      edgeSlow: 0.2,
      edgeTurbulence: 0.24,
      edgeDeflection: 0.02,
      edgeLift: 0.11,
      groundBlock: 0.93,
      airBlock: 0.58,
      edgePocket: 0.1,
      edgeAir: 0.08,
      shadeRetention: 0,
    };
  }
  if (mode === "wake") {
    return {
      slow: 0.46,
      edgeSlow: 0.12,
      edgeTurbulence: 0.44,
      edgeDeflection: 0.034,
      edgeLift: 0.25,
      groundBlock: 0.72,
      airBlock: 0.4,
      edgePocket: 0.28,
      edgeAir: 0.18,
      shadeRetention: 0.04,
    };
  }
  if (mode === "shade") {
    return {
      slow: 0.5,
      edgeSlow: 0.18,
      edgeTurbulence: 0.2,
      edgeDeflection: 0.014,
      edgeLift: 0.07,
      groundBlock: 0.64,
      airBlock: 0.5,
      edgePocket: 0.23,
      edgeAir: 0.06,
      shadeRetention: 0.22,
    };
  }
  return {
    slow: 0.5,
    edgeSlow: 0.16,
    edgeTurbulence: 0.26,
    edgeDeflection: 0.018,
    edgeLift: 0.16,
    groundBlock: 0.82,
    airBlock: 0.46,
    edgePocket: 0.16,
    edgeAir: 0.1,
    shadeRetention: 0.06,
  };
}

function surfaceRetention(surface) {
  if (surface === "forest") return 1.28;
  if (surface === "grass") return 1.18;
  if (surface === "soil") return 1.08;
  if (surface === "pavement") return 0.68;
  return 1;
}

function sourceTypeProfile(settings) {
  const type = settings.sourceType ?? "moving-live";
  const decompositionStage = settings.decompositionStage ?? "none";
  const profiles = {
    "moving-live": { continuous: false, trail: 1.12, source: 0.84, patch: 0.54, chemical: 0.16 },
    "stationary-live": { continuous: true, trail: 0.28, source: 1.08, patch: 0.22, chemical: 0.1 },
    "training-aid": { continuous: false, trail: 0.48, source: 0.92, patch: 0.38, chemical: 0.14 },
    animal: { continuous: false, trail: 0.92, source: 0.88, patch: 0.48, chemical: 0.16 },
    decomposition: { continuous: true, trail: 0.18, source: 1.02, patch: 0.34, chemical: 0.42 },
    submerged: { continuous: true, trail: 0.08, source: 0.82, patch: 0.46, chemical: 0.34 },
  };
  const profile = profiles[type] ?? profiles["moving-live"];
  const stageBoost =
    decompositionStage === "fresh" ? 0.86 : decompositionStage === "active" ? 1.18 : decompositionStage === "advanced" ? 0.98 : 1;
  return { ...profile, source: profile.source * (type === "decomposition" ? stageBoost : 1) };
}

function ageProfile(settings, releaseAgeHours, weather, localEnvironment = null) {
  const profile = sourceTypeProfile(settings);
  const sourceAge = Math.max(0, settings.sourceAgeHours ?? settings.trackAge ?? 0);
  const trailAge = Math.max(0, settings.trailAgeHours ?? settings.trackAge ?? 0);
  const plumeAge = Math.max(0.1, settings.plumeAgeHours ?? Math.min(sourceAge, 3));
  const airLoss = clamp(settings.airborneLossRate ?? 0.34, 0.02, 0.95);
  const depositionRate = clamp(settings.surfaceDepositionRate ?? 0.42, 0.02, 0.95);
  const chemicalRate = clamp((settings.chemicalChangeRate ?? 0.18) + profile.chemical * 0.22, 0, 0.95);
  const rereleaseRate = clamp(settings.rereleaseRate ?? 0.28, 0, 0.95);
  const rain = clamp(weather?.rain ?? settings.rain ?? 0, 0, 1);
  const heat = clamp(((weather?.temperature ?? settings.temperature ?? 68) - 55) / 45, 0, 1);
  const humidity = clamp((weather?.humidity ?? settings.humidity ?? 60) / 100, 0, 1);
  const solar = clamp(settings.sunlight ?? 0.5, 0, 1);
  const surfaceHold = clamp(localEnvironment?.surfaceHold ?? 1, 0.04, 1.9);
  const moisture = clamp(localEnvironment?.moisture ?? 0, 0, 1);
  const sourceContinuity = profile.continuous ? clamp(0.46 + sourceAge / 18, 0.46, 1.28) : Math.exp(-sourceAge * airLoss / 26);
  const trailRetention = Math.exp(-trailAge * (0.055 + airLoss * 0.045 + chemicalRate * 0.035)) * (0.7 + surfaceHold * 0.28 + moisture * 0.16);
  const plumeRetention = Math.exp(-releaseAgeHours * (0.08 + airLoss * 0.05));
  const rainWash = rain > 0.22 ? clamp((rain - 0.22) * 0.85, 0, 0.55) : 0;
  const deposition = clamp(depositionRate * (0.42 + humidity * 0.28 + surfaceHold * 0.28 + rain * 0.2), 0.04, 0.9);
  const rerelease = clamp(rereleaseRate * (0.22 + heat * 0.38 + solar * 0.25 + (weather?.windSpeed ?? settings.windSpeed ?? 2) / 18) * (1 - rain * 0.45), 0, 0.78);
  const width = clamp(1 + trailAge / 10 + plumeAge / 6 + (1 - (settings.stability ?? 0.5)) * 0.75 + (settings.gustiness ?? 0.4) * 0.6, 1, 7);
  const patchiness = clamp(profile.patch + trailAge / 38 + plumeAge / 14 + (settings.contamination ?? 0) * 0.48 + rainWash * 0.38, 0, 1);
  const contamination = clamp((settings.contamination ?? 0) + trailAge / 96 + chemicalRate * 0.22 + rainWash * 0.16, 0, 1);
  const sourceStrength = clamp(profile.source * sourceContinuity * (profile.continuous ? 1 : trailRetention), 0.03, 1.8);
  return { sourceStrength, trailRetention, plumeRetention, deposition, rerelease, width, patchiness, contamination, rainWash };
}

function waterBodyFactor(type) {
  if (type === "river" || type === "canal") return 1.24;
  if (type === "ocean") return 1.36;
  if (type === "lake") return 1.08;
  if (type === "pond") return 0.92;
  return 1;
}

function buildWaterPath(settings, time) {
  if (!settings.waterEnabled && settings.sourceType !== "submerged") return [];
  const bodyFactor = waterBodyFactor(settings.waterBodyType);
  const depth = Math.max(0.1, settings.waterDepth ?? 2);
  const currentSpeed = Math.max(0, settings.waterCurrentSpeed ?? 0.12);
  const currentAngle = (90 - (settings.waterCurrentDir ?? settings.windDir ?? 0)) * DEG;
  const mixing = clamp(settings.verticalMixing ?? 0.4, 0, 1);
  const turbulence = clamp(settings.waterTurbulence ?? 0.35, 0, 1);
  const buoyancy = clamp(settings.sourceBuoyancy ?? 0.5, 0, 1);
  const wave = clamp(settings.waveAction ?? 0.25, 0, 1);
  const salinity = clamp(settings.salinity ?? 0, 0, 1);
  const riseMinutes = depth / Math.max(0.05, 0.06 + buoyancy * 0.18 + mixing * 0.12 - salinity * 0.025);
  const underwaterDistance = clamp(currentSpeed * riseMinutes * 60 * bodyFactor, depth * 2, settings.radius * 1.2);
  const lateralSpread = clamp(depth * (4 + turbulence * 10) + settings.radius * (0.035 + wave * 0.085), 8, settings.radius * 0.42);
  const volatileShare = clamp(0.28 + wave * 0.28 + turbulence * 0.22 + buoyancy * 0.18 - salinity * 0.08, 0.08, 0.92);
  const surfaceX = Math.cos(currentAngle) * underwaterDistance;
  const surfaceY = Math.sin(currentAngle) * underwaterDistance;
  const weather = weatherAt(settings, time, {}, surfaceX, surfaceY);
  const windAngle = (90 - weather.windDir) * DEG;
  const airDistance = clamp(weather.windSpeed * (settings.plumeAgeHours ?? 1.2) * 46 * (0.55 + volatileShare), 20, settings.radius * 1.5);
  const zones = [];
  for (let i = 0; i <= 10; i += 1) {
    const f = i / 10;
    const wobble = Math.sin(i * 1.7) * lateralSpread * 0.22;
    const x = Math.cos(currentAngle) * underwaterDistance * f + Math.cos(currentAngle + Math.PI / 2) * wobble;
    const y = Math.sin(currentAngle) * underwaterDistance * f + Math.sin(currentAngle + Math.PI / 2) * wobble;
    zones.push({ x, y, intensity: (1 - f * 0.42) * (0.6 + currentSpeed * 0.2), uncertainty: clamp(0.28 + f * 0.34 + turbulence * 0.24, 0, 1), stage: "underwater" });
  }
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = lateralSpread * (0.32 + rand(i + 21) * 0.72);
    zones.push({ x: surfaceX + Math.cos(angle) * radius, y: surfaceY + Math.sin(angle) * radius, intensity: volatileShare, uncertainty: clamp(0.22 + turbulence * 0.28 + wave * 0.22, 0, 1), stage: "surface" });
  }
  for (let i = 1; i <= 12; i += 1) {
    const f = i / 12;
    const spread = lateralSpread * (0.4 + f * 1.2 + (settings.gustiness ?? 0.4));
    const side = signedRand(i * 17 + Math.floor(time * 10)) * spread;
    const x = surfaceX + Math.cos(windAngle) * airDistance * f + Math.cos(windAngle + Math.PI / 2) * side;
    const y = surfaceY + Math.sin(windAngle) * airDistance * f + Math.sin(windAngle + Math.PI / 2) * side;
    zones.push({ x, y, intensity: volatileShare * (1 - f * 0.62), uncertainty: clamp(0.3 + f * 0.42 + wave * 0.16, 0, 1), stage: "airborne" });
  }
  return zones;
}

function seriesValue(values, time, fallback) {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  const hour = clamp(time, 0, 23.999);
  const i = Math.floor(hour);
  const j = Math.min(values.length - 1, i + 1);
  const f = hour - i;
  const a = Number(values[Math.min(values.length - 1, i)]);
  const b = Number(values[j]);
  if (!Number.isFinite(a)) return fallback;
  if (!Number.isFinite(b)) return a;
  return a * (1 - f) + b * f;
}

function seriesValueAtIndex(values, index, fallback) {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  const bounded = clamp(index, 0, values.length - 1);
  const i = Math.floor(bounded);
  const j = Math.min(values.length - 1, i + 1);
  const f = bounded - i;
  const a = Number(values[i]);
  const b = Number(values[j]);
  if (!Number.isFinite(a)) return fallback;
  if (!Number.isFinite(b)) return a;
  return a * (1 - f) + b * f;
}

function sampleHourIndex(sample, time, ageHours = 0) {
  const hourlyTimes = sample.hourly?.time ?? [];
  const currentIndex = hourlyTimes.indexOf(sample.current?.time);
  if (currentIndex < 0) return null;
  const currentHour = Number(String(sample.current?.time ?? "").slice(11, 13));
  if (!Number.isFinite(currentHour)) return null;
  let hourDelta = time - currentHour;
  if (hourDelta > 12) hourDelta -= 24;
  if (hourDelta < -12) hourDelta += 24;
  return currentIndex + hourDelta - ageHours;
}

function sampleWeather(sample, time, settings, ageHours = 0) {
  const index = sampleHourIndex(sample, time, ageHours);
  if (index !== null) {
    return {
      windSpeed: seriesValueAtIndex(sample.hourly?.windSpeed, index, sample.current?.windSpeed ?? settings.windSpeed),
      windDir: seriesValueAtIndex(sample.hourly?.windDir, index, sample.current?.windDir ?? settings.windDir),
      windGust: seriesValueAtIndex(sample.hourly?.windGust, index, sample.current?.windGust ?? settings.windSpeed),
      temperature: seriesValueAtIndex(sample.hourly?.temperature, index, sample.current?.temperature ?? settings.temperature),
      humidity: seriesValueAtIndex(sample.hourly?.humidity, index, sample.current?.humidity ?? settings.humidity),
      precipitation: seriesValueAtIndex(sample.hourly?.precipitation, index, sample.current?.precipitation ?? settings.rain),
    };
  }
  return {
    windSpeed: seriesValue(sample.hourly?.windSpeed, time, sample.current?.windSpeed ?? settings.windSpeed),
    windDir: seriesValue(sample.hourly?.windDir, time, sample.current?.windDir ?? settings.windDir),
    windGust: seriesValue(sample.hourly?.windGust, time, sample.current?.windGust ?? settings.windSpeed),
    temperature: seriesValue(sample.hourly?.temperature, time, sample.current?.temperature ?? settings.temperature),
    humidity: seriesValue(sample.hourly?.humidity, time, sample.current?.humidity ?? settings.humidity),
    precipitation: seriesValue(sample.hourly?.precipitation, time, sample.current?.precipitation ?? settings.rain),
  };
}

function interpolateWeatherField(settings, time, x = 0, y = 0, ageHours = 0) {
  const samples = settings.weatherGrid?.samples ?? [];
  if (settings.weatherSource !== "live" || samples.length === 0) return null;

  let weightTotal = 0;
  let windSin = 0;
  let windCos = 0;
  let windSpeed = 0;
  let windGust = 0;
  let temperature = 0;
  let humidity = 0;
  let precipitation = 0;

  for (const sample of samples) {
    const dx = x - (sample.x ?? 0);
    const dy = y - (sample.y ?? 0);
    const weight = 1 / Math.max(40 * 40, dx * dx + dy * dy);
    const weather = sampleWeather(sample, time, settings, ageHours);
    const dir = (Number(weather.windDir) || settings.windDir) * DEG;
    weightTotal += weight;
    windSin += Math.sin(dir) * weight;
    windCos += Math.cos(dir) * weight;
    windSpeed += weather.windSpeed * weight;
    windGust += weather.windGust * weight;
    temperature += weather.temperature * weight;
    humidity += weather.humidity * weight;
    precipitation += weather.precipitation * weight;
  }

  if (weightTotal <= 0) return null;
  return {
    windDir: (Math.atan2(windSin / weightTotal, windCos / weightTotal) / DEG + 360) % 360,
    windSpeed: windSpeed / weightTotal,
    windGust: windGust / weightTotal,
    temperature: temperature / weightTotal,
    humidity: humidity / weightTotal,
    precipitation: precipitation / weightTotal,
    sampleCount: samples.length,
  };
}

function weatherAt(settings, time, variant = {}, x = 0, y = 0, localEnvironment = null) {
  const dayHeat = Math.sin(((time - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
  const eveningSettle = Math.max(0, Math.cos(((time - 20) / 24) * Math.PI * 2));
  const stabilitySettle = settings.stability * 0.34 - (1 - settings.stability) * 0.18;
  const shift = Math.sin(time * 0.78) * 26 * settings.gustiness + Math.sin(time * 1.9) * 9;
  const sampled = interpolateWeatherField(settings, time, x, y, variant.ageHours ?? 0);
  if (sampled) {
    const terrainSlow = clamp(
      1 -
        (localEnvironment?.canopy ?? 0) * 0.13 -
        (localEnvironment?.buildingEdge ?? 0) * 0.1 -
        (localEnvironment?.lowPoint ?? 0) * 0.08 +
        (localEnvironment?.impervious ?? 0) * 0.05,
      0.58,
      1.12,
    );
    const localShift =
      ((localEnvironment?.buildingEdge ?? 0) - (localEnvironment?.canopy ?? 0) * 0.35 + (localEnvironment?.lowPoint ?? 0) * 0.18) *
      signedRand(Math.round((x + 5000) * 3 + (y + 5000) * 5 + time * 11)) *
      18;
    return {
      windDir: (sampled.windDir + localShift + (variant.windDirOffset ?? 0) + 360) % 360,
      windSpeed: clamp(sampled.windSpeed * terrainSlow * (variant.windScale ?? 1), 0.1, 15),
      windGust: clamp(sampled.windGust * (variant.windScale ?? 1), 0.1, 22),
      temperature: sampled.temperature,
      humidity: clamp(sampled.humidity + (localEnvironment?.moisture ?? 0) * 8 - (localEnvironment?.impervious ?? 0) * 4, 5, 100),
      rain: clamp(sampled.precipitation / 4 + (variant.rainOffset ?? 0), 0, 1),
      settle: clamp(0.62 + eveningSettle * 0.26 - dayHeat * 0.16 + stabilitySettle + (localEnvironment?.lowPoint ?? 0) * 0.12, 0.34, 1.34),
      dayHeat,
      source: "live-grid",
      sampleCount: sampled.sampleCount,
    };
  }
  return {
    windDir: (settings.windDir + shift + (variant.windDirOffset ?? 0) + 360) % 360,
    windSpeed: clamp(settings.windSpeed * (0.72 + dayHeat * 0.42 + Math.sin(time * 1.27) * settings.gustiness * 0.22) * (variant.windScale ?? 1), 0.1, 15),
    windGust: settings.windSpeed * (1.15 + settings.gustiness * 0.8),
    temperature: settings.temperature + (dayHeat - 0.5) * 17,
    humidity: clamp(settings.humidity + (0.5 - dayHeat) * 15 + settings.rain * 18 + (localEnvironment?.moisture ?? 0) * 8 - (localEnvironment?.impervious ?? 0) * 4, 5, 100),
    rain: clamp(settings.rain + (variant.rainOffset ?? 0), 0, 1),
    settle: clamp(0.62 + eveningSettle * 0.26 - dayHeat * 0.16 + stabilitySettle + (localEnvironment?.lowPoint ?? 0) * 0.12, 0.34, 1.34),
    dayHeat,
    source: "manual",
    sampleCount: 0,
  };
}

function obstacleEffect(x, y, obstacle, windX, windY, radius) {
  const dx = x - obstacle.x;
  const dy = y - obstacle.y;
  const downwind = dx * windX + dy * windY;
  const cross = dx * -windY + dy * windX;
  const distance = Math.hypot(dx, dy);
  const scale = radius * (obstacle.type === "building" ? 0.33 : 0.23);
  const near = Math.exp(-(distance * distance) / (2 * (scale * 0.22) ** 2));
  const wake = downwind > 0 ? Math.exp(-(cross * cross) / (scale * scale * 0.2)) * Math.exp(-downwind / (scale * 1.45)) : 0;

  if (obstacle.type === "building") return { block: 1 - near * 0.55, lift: wake * 0.28, channel: -cross * wake * 0.012 };
  if (obstacle.type === "tree") return { block: 1 - near * 0.18, lift: -wake * 0.16, channel: cross * wake * 0.004 };
  if (obstacle.type === "drainage") return { block: 1, lift: -wake * 0.2, channel: -Math.sign(cross || 1) * wake * 0.55 };
  return { block: 1 - near * 0.12, lift: wake * 0.06, channel: Math.sign(cross || 1) * wake * 0.1 };
}

function makeSources(settings, time) {
  const typeProfile = sourceTypeProfile(settings);
  const currentWeather = weatherAt(settings, time, {}, 0, 0);
  const currentAgeProfile = ageProfile(settings, Math.min(settings.plumeAgeHours ?? 1, settings.sourceAgeHours ?? 1), currentWeather);
  const sources = [
    {
      kind: settings.sourceType === "moving-live" || settings.sourceType === "animal" ? "trail" : settings.sourceType === "submerged" ? "water-source" : "subject",
      x: 0,
      y: 0,
      z: 0.15,
      weight: settings.sourceStrength * currentAgeProfile.sourceStrength,
      strength: settings.sourceStrength * currentAgeProfile.sourceStrength,
      food: 0,
      leakRate: 1,
      itemAge: settings.sourceAgeHours ?? settings.trackAge,
      recharge: 1,
      trailAge: settings.trailAgeHours ?? settings.trackAge,
      plumeAge: settings.plumeAgeHours ?? 1,
      continuous: typeProfile.continuous,
      sourceType: settings.sourceType ?? "moving-live",
      ventDirection: settings.windDir,
    },
  ];

  for (const chamber of settings.chambers ?? []) {
    if (!chamber.active) continue;
    const [x, y] = lonLatToLocal(chamber.lon, chamber.lat, settings.lat, settings.lon);
    const leakRate = clamp(chamber.leakRate ?? 0.62, 0.08, 1.25);
    const itemAge = Math.max(0, chamber.itemAge ?? settings.trackAge);
    const rechargeHours = Math.max(1, chamber.rechargeHours ?? 24);
    const rechargePhase = ((time % rechargeHours) / rechargeHours) * Math.PI * 2;
    const recharge = clamp(0.76 + Math.cos(rechargePhase) * 0.12 + leakRate * 0.1, 0.45, 1.08);
    const ageRetention = Math.exp(-itemAge / 72);
    const strength = chamber.scentStrength * leakRate * (0.58 + ageRetention * 0.42) * recharge;
    const food = chamber.foodStrength * (0.72 + leakRate * 0.18);
    sources.push({
      kind: "chamber",
      id: chamber.id,
      x,
      y,
      z: chamber.ventHeight,
      weight: strength * 0.95 + food * 0.42,
      strength,
      food,
      leakRate,
      itemAge,
      recharge,
      ventDirection: chamber.ventDirection ?? settings.windDir,
    });
  }

  return sources;
}

function activeChamberExtent(settings) {
  let farthest = 0;
  if (settings.waterEnabled || settings.sourceType === "submerged") {
    for (const zone of buildWaterPath(settings, 12)) farthest = Math.max(farthest, Math.hypot(zone.x, zone.y));
  }
  for (const chamber of settings.chambers ?? []) {
    if (!chamber.active) continue;
    const [x, y] = lonLatToLocal(chamber.lon, chamber.lat, settings.lat, settings.lon);
    farthest = Math.max(farthest, Math.hypot(x, y));
  }
  return farthest;
}

function solverDomainRadius(settings) {
  const analysisRadius = settings.radius;
  const baseFactor = analysisRadius >= 1000 ? 1.9 : analysisRadius <= 300 ? 2.6 : 2.25;
  const baseDomain = analysisRadius * baseFactor;
  const chamberExtent = activeChamberExtent(settings);
  if (chamberExtent <= analysisRadius * 0.75) return baseDomain;
  return Math.max(baseDomain, chamberExtent + analysisRadius * 1.45 + 180);
}

function pickSource(sources, seed, index = 0, guaranteedPasses = 0) {
  if (guaranteedPasses > 0 && index < sources.length * guaranteedPasses) return sources[index % sources.length];
  const total = sources.reduce((sum, source) => sum + source.weight, 0);
  let cursor = rand(seed) * total;
  for (const source of sources) {
    cursor -= source.weight;
    if (cursor <= 0) return source;
  }
  return sources[0];
}

function makeParticle(settings, seed, releaseAge, source) {
  const sourceJitter = settings.radius * 0.025;
  const releaseAgeHours = releaseAge / 60;
  const age = ageProfile(settings, releaseAgeHours, weatherAt(settings, Math.max(0, (settings.plumeAgeHours ?? 1) - releaseAgeHours), {}, source.x, source.y));
  const trailBias = source.kind === "trail" ? Math.min(settings.radius * 0.44, (source.trailAge ?? settings.trackAge ?? 0) * 5.2 + releaseAgeHours * 8) : Math.min(settings.radius * 0.08, releaseAge * 0.04);
  const bearing = (90 - settings.windDir + 180) * DEG;
  const chamberSpread = source.kind === "chamber" ? settings.radius * (0.004 + (source.leakRate ?? 0.6) * 0.012) : sourceJitter;
  const ventBearing = (90 - (source.ventDirection ?? settings.windDir)) * DEG;
  const ventBias = source.kind === "chamber" ? settings.radius * (0.018 + (source.leakRate ?? 0.6) * 0.028) * rand(seed + 23) : 0;
  const leakAgePenalty = source.kind === "chamber" ? Math.exp(-(source.itemAge ?? 0) / 120) : 1;
  const trailSpread = source.kind === "trail" ? settings.radius * 0.012 * age.width : 0;
  const patchGate = source.kind === "trail" ? clamp(1 - age.patchiness * rand(seed + 41), 0.18, 1) : 1;
  return {
    sourceKind: source.kind,
    sourceId: source.id,
    x:
      source.x +
      signedRand(seed + 3) * (chamberSpread + trailSpread) +
      (source.kind === "trail" ? Math.cos(bearing) * trailBias * rand(seed + 5) : source.kind === "subject" ? signedRand(seed + 5) * sourceJitter * 0.35 : Math.cos(ventBearing) * ventBias),
    y:
      source.y +
      signedRand(seed + 7) * (chamberSpread + trailSpread) +
      (source.kind === "trail" ? Math.sin(bearing) * trailBias * rand(seed + 11) : source.kind === "subject" ? signedRand(seed + 11) * sourceJitter * 0.35 : Math.sin(ventBearing) * ventBias),
    z: source.z + rand(seed + 13) * (source.kind === "chamber" ? 0.35 + (source.leakRate ?? 0.6) * 0.65 : 1.2),
    age: releaseAge,
    mass: (source.strength * (0.72 + rand(seed + 17) * 0.56) + source.food * 0.18) * leakAgePenalty * age.plumeRetention * patchGate,
    ageProfile: age,
  };
}

function addSourcePool(ground, air, drainage, surfaceDeposit, reRelease, waterSignal, environment, gridSize, step, radius, source, settings, time, variant) {
  if (Math.hypot(source.x, source.y) > radius * 0.995) return;
  const envHere = environmentAt(environment, gridSize, step, radius, source.x, source.y);
  const weather = weatherAt(settings, time, variant, source.x, source.y, envHere);
  const age = ageProfile(settings, source.plumeAge ?? settings.plumeAgeHours ?? 1, weather, envHere);
  const rain = clamp(weather.rain ?? settings.rain, 0, 1);
  const isChamber = source.kind === "chamber";
  const isWater = source.kind === "water-source";
  const pooledMass = (source.strength * (isChamber ? 8.5 : isWater ? 2.2 : 4.2) + source.food * (isChamber ? 2.8 : 0.5)) * age.sourceStrength;
  const hold = clamp(envHere.surfaceHold * (0.84 + envHere.canopy * 0.18 + envHere.moisture * 0.16 - envHere.impervious * 0.16), 0.18, 1.9);
  const localLift = clamp(0.2 + source.z / 9 + envHere.road * 0.08 + envHere.impervious * 0.05 - envHere.canopy * 0.06, 0.08, 0.82);
  const drainShare = clamp(rain * settings.drainage * (envHere.drainage + envHere.lowPoint * 0.32) * 0.52, 0, 0.5);
  const surfaceMass = pooledMass * hold * age.deposition * (1 - localLift * 0.36);
  const rereleaseMass = surfaceMass * age.rerelease * (0.64 + weather.windSpeed * 0.04);
  addKernel(ground, gridSize, step, radius, source.x, source.y, pooledMass * hold * (1 - localLift * 0.42) * (1 - age.deposition * 0.28));
  addKernel(surfaceDeposit, gridSize, step, radius, source.x, source.y, surfaceMass);
  addKernel(reRelease, gridSize, step, radius, source.x, source.y, rereleaseMass);
  addKernel(air, gridSize, step, radius, source.x, source.y, pooledMass * localLift * (0.54 + weather.windSpeed * 0.035) + rereleaseMass * 0.72);
  addKernel(drainage, gridSize, step, radius, source.x, source.y - settings.drainage * rain * settings.radius * 0.04, pooledMass * drainShare);
  if (isWater) addKernel(waterSignal, gridSize, step, radius, source.x, source.y, pooledMass * 0.7);
}

function addKernel(grid, gridSize, step, radius, x, y, mass) {
  const gx = Math.round((x + radius) / step);
  const gy = Math.round((y + radius) / step);
  const kernelRadius = 2;
  for (let yy = gy - kernelRadius; yy <= gy + kernelRadius; yy += 1) {
    if (yy < 0 || yy >= gridSize) continue;
    for (let xx = gx - kernelRadius; xx <= gx + kernelRadius; xx += 1) {
      if (xx < 0 || xx >= gridSize) continue;
      const cx = -radius + xx * step;
      const cy = -radius + yy * step;
      if (Math.hypot(cx, cy) > radius) continue;
      const d = Math.hypot(cx - x, cy - y);
      const w = Math.exp(-(d * d) / (2 * (step * 1.35) ** 2));
      grid[yy * gridSize + xx] += mass * w;
    }
  }
}

function simulate(settings, time, variant = {}) {
  const analysisRadius = settings.radius;
  const domainRadius = solverDomainRadius(settings);
  const radius = domainRadius;
  const rasterSettings = { ...settings, radius: domainRadius };
  const coarse = variant.quality === "coarse";
  const gridSize = coarse ? (analysisRadius <= 300 ? 31 : analysisRadius <= 600 ? 35 : 39) : analysisRadius <= 300 ? 47 : analysisRadius <= 600 ? 53 : 61;
  const step = (domainRadius * 2) / (gridSize - 1);
  const ground = new Float32Array(gridSize * gridSize);
  const air = new Float32Array(gridSize * gridSize);
  const drainage = new Float32Array(gridSize * gridSize);
  const surfaceDeposit = new Float32Array(gridSize * gridSize);
  const reRelease = new Float32Array(gridSize * gridSize);
  const waterSignal = new Float32Array(gridSize * gridSize);
  const plumeAge = new Float32Array(gridSize * gridSize);
  const environment = getEnvironmentRaster(rasterSettings, gridSize, step);
  const buildingMode = buildingModeCoefficients(settings.buildingMode);
  const obstacles = makeObstacles(rasterSettings);
  const sources = makeSources(settings, time);
  const extraSources = Math.max(0, sources.length - 1);
  const sourceBonus = extraSources === 0 ? 0 : Math.round((analysisRadius >= 1000 ? 420 : 260) * Math.sqrt(extraSources));
  const baseParticleCount = (analysisRadius >= 1000 ? 1800 : analysisRadius <= 300 ? 520 : 760) + sourceBonus;
  const particleCount = Math.max(180, Math.round(baseParticleCount * (variant.particleScale ?? (coarse ? 0.35 : 1))));
  const guaranteedSourcePasses = Math.min(18, Math.max(4, Math.floor(particleCount / Math.max(1, sources.length * 4))));
  const historyHours = clamp(Math.max(settings.trackAge ?? 0, settings.sourceAgeHours ?? 0, settings.trailAgeHours ?? 0, settings.plumeAgeHours ?? 0) + 2 + settings.stability * 3 + (analysisRadius >= 1000 ? 1.5 : 0), 2, 72);
  const retention = surfaceRetention(settings.surface);
  const rain = clamp(weatherAt(settings, time, variant, 0, 0).rain ?? settings.rain, 0, 1);

  for (const source of sources) {
    addSourcePool(ground, air, drainage, surfaceDeposit, reRelease, waterSignal, environment, gridSize, step, radius, source, settings, time, variant);
  }

  const waterZones = buildWaterPath(settings, time);
  for (const zone of waterZones) {
    const stageMass = zone.intensity * (zone.stage === "underwater" ? 1.6 : zone.stage === "surface" ? 2.4 : 1.3) * settings.sourceStrength;
    addKernel(waterSignal, gridSize, step, radius, zone.x, zone.y, stageMass);
    if (zone.stage === "surface") {
      addKernel(surfaceDeposit, gridSize, step, radius, zone.x, zone.y, stageMass * 0.44);
      addKernel(reRelease, gridSize, step, radius, zone.x, zone.y, stageMass * (0.26 + (settings.waveAction ?? 0.25) * 0.36));
      addKernel(air, gridSize, step, radius, zone.x, zone.y, stageMass * 0.62);
    }
    if (zone.stage === "airborne") addKernel(air, gridSize, step, radius, zone.x, zone.y, stageMass * 0.86);
  }

  for (let i = 0; i < particleCount; i += 1) {
    const releaseAge = rand(i * 31 + 9) * historyHours;
    const source = pickSource(sources, i * 43 + Math.floor(time * 5), i, guaranteedSourcePasses);
    const p = makeParticle(settings, i * 97 + Math.floor(time * 11), releaseAge * 60, source);
    const steps = 10 + Math.floor(rand(i + 4) * 8);
    const dt = (releaseAge * 3600) / steps;

    for (let s = 0; s < steps; s += 1) {
      const t = (time - releaseAge + (releaseAge * s) / steps + 48) % 24;
      const envHere = environmentAt(environment, gridSize, step, radius, p.x, p.y);
      const remainingAgeHours = Math.max(0, releaseAge - (releaseAge * s) / steps);
      const weather = weatherAt(settings, t, { ...variant, ageHours: remainingAgeHours }, p.x, p.y, envHere);
      const angle = (90 - weather.windDir) * DEG;
      const windX = Math.cos(angle);
      const windY = Math.sin(angle);
      const roughSlow = clamp(
        1 -
          settings.roughness * 0.24 -
          settings.canopy * 0.16 -
          environment.avgCanopy * 0.08 -
          environment.avgMoisture * 0.05 -
          envHere.building * buildingMode.slow -
          envHere.buildingEdge * buildingMode.edgeSlow +
          envHere.lowPoint * 0.08 +
          environment.avgRoad * 0.04 +
          envHere.impervious * 0.04,
        0.12,
        1.18,
      );
      const speed = weather.windSpeed * roughSlow;
      const turbulence =
        (0.12 +
          settings.gustiness * 0.42 +
          (1 - settings.stability) * 0.34 +
          settings.roughness * 0.16 +
          envHere.buildingEdge * buildingMode.edgeTurbulence +
          envHere.drainage * rain * 0.18 +
          envHere.lowPoint * 0.11 +
          envHere.road * 0.08 -
          envHere.canopy * 0.08 -
          envHere.moisture * 0.05) *
        Math.sqrt(Math.max(dt, 1));

      let channel = 0;
      let liftFromObstacles = 0;
      let block = 1;
      for (const obstacle of obstacles) {
        const effect = obstacleEffect(p.x, p.y, obstacle, windX, windY, analysisRadius);
        channel += effect.channel;
        liftFromObstacles += effect.lift;
        block *= effect.block;
      }

      const crossX = -windY;
      const crossY = windX;
      const buildingDeflection = envHere.buildingEdge * signedRand(i * 37 + s * 41) * dt * buildingMode.edgeDeflection;
      p.x += windX * speed * dt * 0.035 * block + crossX * (channel * dt * 0.018 + buildingDeflection) + signedRand(i * 13 + s * 19) * turbulence;
      p.y += windY * speed * dt * 0.035 * block + crossY * (channel * dt * 0.018 + buildingDeflection) + signedRand(i * 17 + s * 23) * turbulence;
      p.z +=
        (weather.dayHeat * settings.sunlight * 0.2 +
          liftFromObstacles +
          envHere.buildingEdge * buildingMode.edgeLift +
          envHere.road * 0.05 +
          envHere.impervious * 0.04 -
          envHere.drainage * rain * 0.22 -
          envHere.lowPoint * 0.14 -
          weather.settle * 0.15 -
          settings.canopy * 0.09 -
          envHere.canopy * 0.08 -
          envHere.moisture * 0.07 -
          rain * 0.18) *
        dt *
        0.01;
      p.z += signedRand(i * 29 + s * 31) * turbulence * 0.012;
      p.z = clamp(p.z, 0, 18);

      const heatDecay = clamp((weather.temperature - 58) / 82 + envHere.impervious * 0.05 - envHere.moisture * 0.04, 0.02, 0.52);
      const humidityPreserve = 0.62 + weather.humidity / 145 + envHere.moisture * 0.06 + envHere.surfaceHold * 0.025;
      const ageDecay = Math.exp(-dt / (3600 * (10 + weather.humidity * 0.12 + settings.stability * 5)));
      const sunDecay = 1 - settings.sunlight * heatDecay * 0.012;
      const rainDecay = rain > 0.45 ? 1 - (rain - 0.45) * 0.035 : 1 + rain * 0.005;
      p.mass *= ageDecay * sunDecay * rainDecay * humidityPreserve;

      if (Math.hypot(p.x, p.y) > radius * 0.98 || p.mass < 0.0007) break;
    }

    const particleEnvironment = environmentAt(environment, gridSize, step, radius, p.x, p.y);
    const finalWeather = weatherAt(settings, time, variant, p.x, p.y, particleEnvironment);
    const age = p.ageProfile ?? ageProfile(settings, releaseAge, finalWeather, particleEnvironment);
    const nearDrain = clamp(particleEnvironment.drainage + particleEnvironment.road * 0.08, 0, 1);
    const groundFraction = clamp(
      (1.15 - p.z / 5) * retention * particleEnvironment.surfaceHold * (0.72 + settings.stability * 0.36 + settings.canopy * 0.26 + particleEnvironment.moisture * 0.12),
      0.05,
      1,
    );
    const drainageFraction = clamp(rain * settings.drainage * nearDrain * (0.45 + particleEnvironment.lowPoint * 0.26), 0, 0.84);
    const airFraction = clamp(1 - groundFraction - drainageFraction * 0.45, 0.04, 0.95);
    const surfaceFraction = clamp(age.deposition * groundFraction * (0.55 + particleEnvironment.surfaceHold * 0.18), 0.02, 0.72);
    const rereleaseFraction = clamp(age.rerelease * surfaceFraction * (0.42 + finalWeather.windSpeed * 0.035), 0, 0.54);

    addKernel(ground, gridSize, step, radius, p.x, p.y, p.mass * groundFraction * (1 - surfaceFraction * 0.34));
    addKernel(surfaceDeposit, gridSize, step, radius, p.x, p.y, p.mass * surfaceFraction);
    addKernel(reRelease, gridSize, step, radius, p.x, p.y, p.mass * rereleaseFraction);
    addKernel(air, gridSize, step, radius, p.x, p.y, p.mass * (airFraction * (0.55 + p.z / 24) + rereleaseFraction * 0.58));
    addKernel(drainage, gridSize, step, radius, p.x, p.y - settings.drainage * rain * analysisRadius * 0.08, p.mass * drainageFraction);
    addKernel(plumeAge, gridSize, step, radius, p.x, p.y, releaseAge * Math.max(0.001, p.mass));
  }

  for (let idx = 0; idx < ground.length; idx += 1) {
    const road = environment.road[idx];
    const canopy = environment.canopy[idx];
    const building = environment.building[idx];
    const buildingEdge = environment.buildingEdge[idx];
    const drain = environment.drainage[idx];
    const impervious = environment.impervious[idx];
    const moisture = environment.moisture[idx];
    const lowPoint = environment.lowPoint[idx];
    const surfaceHold = environment.surfaceHold[idx] || 1;
    const roadLift = ground[idx] * road * 0.18;
    const edgePocket = buildingEdge * (1 - building) * buildingMode.edgePocket;
    const shadeHold = buildingEdge * buildingMode.shadeRetention;
    const drainWash = rain * settings.drainage * drain;
    const ageNow = ageProfile(settings, settings.plumeAgeHours ?? 1, weatherAt(settings, time, variant), { surfaceHold, moisture, drainage: drain, impervious, lowPoint });
    const groundMultiplier = clamp(
      surfaceHold * (1 - road * 0.32 + canopy * 0.22 + moisture * 0.24 + lowPoint * 0.16 - impervious * 0.24 - building * buildingMode.groundBlock + edgePocket + shadeHold - drainWash * 0.18),
      0.03,
      1.85,
    );
    const airMultiplier = clamp(1 + road * 0.16 + impervious * 0.09 - canopy * 0.12 - moisture * 0.06 - lowPoint * 0.1 - building * buildingMode.airBlock + buildingEdge * buildingMode.edgeAir - drainWash * 0.08, 0.08, 1.58);
    ground[idx] *= groundMultiplier;
    air[idx] = air[idx] * airMultiplier + roadLift;
    drainage[idx] += drain * rain * settings.drainage * 0.1 + lowPoint * rain * 0.045 + road * rain * settings.drainage * 0.025 + canopy * rain * 0.012 + buildingEdge * rain * 0.01;
    const reLift = surfaceDeposit[idx] * ageNow.rerelease * clamp(0.22 + impervious * 0.18 + road * 0.08 + (settings.sunlight ?? 0.5) * 0.2 - rain * 0.16, 0.03, 0.62);
    reRelease[idx] += reLift;
    air[idx] += reLift * 0.78;
    drainage[idx] += surfaceDeposit[idx] * drainWash * 0.12;
  }

  return { ground, air, drainage, surfaceDeposit, reRelease, waterSignal, plumeAge, waterZones, gridSize, step, obstacles, analysisRadius, domainRadius, environment };
}

function signalSettingsKey(settings) {
  const chamberKey = (settings.chambers ?? [])
    .map(
      (chamber) =>
        `${chamber.id}:${chamber.active}:${chamber.lat.toFixed(6)}:${chamber.lon.toFixed(6)}:${chamber.scentStrength}:${chamber.foodStrength}:${chamber.ventHeight}:${chamber.ventDirection}:${chamber.leakRate}:${chamber.itemAge}:${chamber.rechargeHours}:${chamber.detectionRadius}`,
    )
    .join("|");
  const weatherKey =
    settings.weatherSource === "live" && settings.weatherGrid
      ? `${settings.weatherGrid.fetchedAt}:${settings.weatherGrid.sampleRadiusMeters}:${settings.weatherGrid.samples?.length ?? 0}`
      : "manual";
  return [
    settings.lat,
    settings.lon,
    settings.radius,
    settings.windDir,
    settings.windSpeed,
    settings.gustiness,
    settings.temperature,
    settings.humidity,
    settings.rain,
    settings.stability,
    settings.roughness,
    settings.canopy,
    settings.drainage,
    settings.sunlight,
    settings.trackAge,
    settings.sourceType,
    settings.sourceAgeHours,
    settings.trailAgeHours,
    settings.plumeAgeHours,
    settings.decompositionStage,
    settings.airborneLossRate,
    settings.surfaceDepositionRate,
    settings.chemicalChangeRate,
    settings.rereleaseRate,
    settings.waterEnabled,
    settings.waterBodyType,
    settings.waterDepth,
    settings.waterCurrentDir,
    settings.waterCurrentSpeed,
    settings.verticalMixing,
    settings.waveAction,
    settings.waterTurbulence,
    settings.sourceBuoyancy,
    settings.salinity,
    settings.contamination,
    settings.sourceStrength,
    settings.surface,
    settings.buildingMode,
    settings.weatherSource,
    weatherKey,
    chamberKey,
    rawEnvironment?.generatedAt ?? "env",
  ].join(":");
}

function buildSignal(settings) {
  const key = signalSettingsKey(settings);
  if (signalCache?.key === key) return signalCache.signal;

  const signal = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    const weather = weatherAt(settings, hour, {}, 0, 0);
    const windWindow = Math.exp(-((weather.windSpeed - 3.2) ** 2) / 18);
    const humidityHold = clamp(weather.humidity / 82, 0.35, 1.35);
    const heatPenalty = clamp(1 - Math.max(0, weather.temperature - 78) * 0.012, 0.45, 1.08);
    const rainBoost = weather.rain < 0.35 ? 1 + weather.rain * 0.26 : 1 - (weather.rain - 0.35) * 0.62;
    const max = settings.sourceStrength * windWindow * humidityHold * heatPenalty * rainBoost * weather.settle * (0.72 + settings.stability * 0.28);
    signal.push({ hour, max });
  }

  signalCache = { key, signal };
  return signal;
}

function normalize(value, max) {
  return clamp(value / Math.max(0.0001, max), 0, 1);
}

function buildVectors(settings, time, sim = null) {
  const gridSize = sim?.gridSize ?? (settings.radius <= 300 ? 35 : settings.radius <= 600 ? 39 : 43);
  const step = sim?.step ?? (settings.radius * 2) / (gridSize - 1);
  const sampleRadius = sim?.domainRadius ?? settings.radius;
  const environment = sim?.environment ?? getEnvironmentRaster(settings, gridSize, step);
  const vectors = [];
  const vectorCount = 5;
  for (let yi = 0; yi < vectorCount; yi += 1) {
    for (let xi = 0; xi < vectorCount; xi += 1) {
      const x = -settings.radius * 0.72 + (xi / (vectorCount - 1)) * settings.radius * 1.44;
      const y = -settings.radius * 0.72 + (yi / (vectorCount - 1)) * settings.radius * 1.44;
      const envHere = environmentAt(environment, gridSize, step, sampleRadius, x, y);
      const weather = weatherAt(settings, time, {}, x, y, envHere);
      const angle = (90 - weather.windDir) * DEG;
      const wobble = (rand(xi * 19 + yi * 43 + Math.floor(time)) - 0.5) * settings.gustiness * 0.65;
      const wx = Math.cos(angle + wobble);
      const wy = Math.sin(angle + wobble);
      const len = settings.radius * clamp(0.08 + weather.windSpeed * 0.014, 0.08, 0.22);
      vectors.push({
        from: localToLonLat(x, y, settings.lat, settings.lon),
        to: localToLonLat(x + wx * len, y + wy * len, settings.lat, settings.lon),
        strength: clamp(weather.windSpeed / 9, 0.1, 1),
      });
    }
  }
  return vectors;
}

function valueAtGrid(sim, x, y) {
  const gx = clamp(Math.round((x + sim.step * (sim.gridSize - 1) * 0.5) / sim.step), 0, sim.gridSize - 1);
  const gy = clamp(Math.round((y + sim.step * (sim.gridSize - 1) * 0.5) / sim.step), 0, sim.gridSize - 1);
  const idx = gy * sim.gridSize + gx;
  return sim.ground[idx] + sim.air[idx] * 0.72 + sim.drainage[idx] * 0.62;
}

function buildDogPath(settings, time, sim) {
  const dogPath = [];
  let px = -settings.radius * 0.74;
  let py = -settings.radius * 0.35;
  for (let i = 0; i < 42; i += 1) {
    const localWeather = weatherAt(settings, time, {}, px, py);
    const angle = (90 - localWeather.windDir) * DEG;
    const sampleAngles = [-1.15, -0.55, 0, 0.55, 1.15].map((offset) => angle + Math.PI + offset + Math.sin(i * 0.8) * settings.gustiness * 0.42);
    let best = { score: -1, x: px, y: py };
    for (const sample of sampleAngles) {
      const nx = px + Math.cos(sample) * settings.radius * 0.065;
      const ny = py + Math.sin(sample) * settings.radius * 0.065;
      const score = valueAtGrid(sim, nx, ny) + rand(i * 41 + sample * 10) * 0.08 - settings.contamination * rand(i * 71 + sample) * 0.04;
      if (score > best.score && Math.hypot(nx, ny) < settings.radius * 0.98) best = { score, x: nx, y: ny };
    }
    px = best.x + Math.sin(i * 1.7) * settings.radius * 0.015;
    py = best.y + Math.cos(i * 1.1) * settings.radius * 0.015;
    dogPath.push(localToLonLat(px, py, settings.lat, settings.lon));
  }
  return dogPath;
}

function buildChamberResults(settings, sim) {
  const domainRadius = sim.domainRadius ?? settings.radius;
  return (settings.chambers ?? []).map((chamber) => {
    const [cx, cy] = lonLatToLocal(chamber.lon, chamber.lat, settings.lat, settings.lon);
    let covered = 0;
    let sampled = 0;
    const sampleRadius = chamber.detectionRadius * 2.8;
    const minXi = clamp(Math.floor((cx - sampleRadius + domainRadius) / sim.step), 0, sim.gridSize - 1);
    const maxXi = clamp(Math.ceil((cx + sampleRadius + domainRadius) / sim.step), 0, sim.gridSize - 1);
    const minYi = clamp(Math.floor((cy - sampleRadius + domainRadius) / sim.step), 0, sim.gridSize - 1);
    const maxYi = clamp(Math.ceil((cy + sampleRadius + domainRadius) / sim.step), 0, sim.gridSize - 1);
    for (let yi = minYi; yi <= maxYi; yi += 1) {
      for (let xi = minXi; xi <= maxXi; xi += 1) {
        const x = -domainRadius + xi * sim.step;
        const y = -domainRadius + yi * sim.step;
        if (Math.hypot(x - cx, y - cy) > sampleRadius) continue;
        sampled += 1;
        const idx = yi * sim.gridSize + xi;
        const value = sim.ground[idx] + sim.air[idx] * 0.72 + sim.drainage[idx] * 0.62;
        if (value > chamber.scentStrength * 0.22) covered += 1;
      }
    }

    return {
      ...chamber,
      coverage: clamp((covered / Math.max(1, sampled)) * (0.72 + chamber.foodStrength * 0.22), 0, 1),
    };
  });
}

function buildField(settings, time, options = {}) {
  const quick = Boolean(options.quick);
  const base = simulate(settings, time, { particleScale: quick ? 0.62 : 1 });
  const left = quick ? null : simulate(settings, time, { windDirOffset: -18 - settings.gustiness * 18, windScale: 0.86, rainOffset: -0.12, particleScale: 0.48 });
  const right = quick ? null : simulate(settings, time, { windDirOffset: 18 + settings.gustiness * 18, windScale: 1.16, rainOffset: 0.14, particleScale: 0.48 });
  const weather = weatherAt(settings, time);
  const analysisRadius = base.analysisRadius ?? settings.radius;
  const domainRadius = base.domainRadius ?? settings.radius;
  const cells = [];
  let max = 0;
  let maxGround = 0;
  let maxAir = 0;
  let maxDrainage = 0;
  let maxSurface = 0;
  let maxReRelease = 0;
  let maxWater = 0;
  let active = 0;
  let total = 0;
  let totalUncertainty = 0;
  let pockets = 0;
  let groundTotal = 0;
  let airTotal = 0;
  let drainageTotal = 0;
  let surfaceTotal = 0;
  let reReleaseTotal = 0;
  let waterTotal = 0;

  for (let i = 0; i < base.ground.length; i += 1) {
    const value = base.ground[i] + base.air[i] * 0.72 + base.drainage[i] * 0.72 + base.reRelease[i] * 0.58 + base.waterSignal[i] * 0.52;
    max = Math.max(max, value);
    maxGround = Math.max(maxGround, base.ground[i]);
    maxAir = Math.max(maxAir, base.air[i]);
    maxDrainage = Math.max(maxDrainage, base.drainage[i]);
    maxSurface = Math.max(maxSurface, base.surfaceDeposit[i]);
    maxReRelease = Math.max(maxReRelease, base.reRelease[i]);
    maxWater = Math.max(maxWater, base.waterSignal[i]);
  }

  for (let yi = 0; yi < base.gridSize; yi += 1) {
    for (let xi = 0; xi < base.gridSize; xi += 1) {
      const idx = yi * base.gridSize + xi;
      const x = -domainRadius + xi * base.step;
      const y = -domainRadius + yi * base.step;
      const distance = Math.hypot(x, y);
      if (distance > domainRadius) continue;
      const outsideRadius = distance > analysisRadius;
      const g = base.ground[idx];
      const a = base.air[idx];
      const d = base.drainage[idx];
      const sfc = base.surfaceDeposit[idx];
      const rr = base.reRelease[idx];
      const water = base.waterSignal[idx];
      const value = g + a * 0.72 + d * 0.72 + rr * 0.58 + water * 0.52;
      const outputCutoff = settings.radius >= 1000 ? 0.006 : settings.radius >= 750 ? 0.018 : 0.035;
      if (value < max * outputCutoff * (outsideRadius ? 0.55 : 1)) continue;

      const intensity = normalize(value, max);
      const signalGate = clamp(intensity * 1.45, 0, 1);
      let uncertainty = 0;
      if (quick) {
        const layerMix = clamp((a + water * 0.55) / Math.max(0.0001, g + a + d + rr + water), 0, 1);
        const ageSpread = clamp((settings.trailAgeHours ?? settings.trackAge ?? 0) / 48 + (settings.plumeAgeHours ?? 0) / 12, 0, 1);
        const motionSpread = settings.gustiness * 0.36 + (1 - settings.stability) * 0.18 + settings.contamination * 0.12 + layerMix * 0.16 + ageSpread * 0.22 + (outsideRadius ? 0.1 : 0);
        uncertainty = clamp(motionSpread * (0.28 + signalGate * 0.72), 0, 1);
      } else {
        const v1 = left.ground[idx] + left.air[idx] * 0.72 + left.drainage[idx] * 0.72 + left.reRelease[idx] * 0.58 + left.waterSignal[idx] * 0.52;
        const v2 = right.ground[idx] + right.air[idx] * 0.72 + right.drainage[idx] * 0.72 + right.reRelease[idx] * 0.58 + right.waterSignal[idx] * 0.52;
        const mean = (value + v1 + v2) / 3;
        const variance = ((value - mean) ** 2 + (v1 - mean) ** 2 + (v2 - mean) ** 2) / 3;
        const ensembleSpread = clamp(Math.sqrt(variance) / Math.max(mean, max * 0.08), 0, 1);
        const ageSpread = clamp((settings.trailAgeHours ?? settings.trackAge ?? 0) / 54 + (settings.plumeAgeHours ?? 0) / 14, 0, 1);
        uncertainty = clamp((ensembleSpread + ageSpread * 0.38) * (0.18 + signalGate * 0.82), 0, 1);
      }
      const groundIntensity = normalize(g, maxGround);
      const airIntensity = normalize(a, maxAir);
      const drainageIntensity = normalize(d, maxDrainage);
      const surfaceIntensity = normalize(sfc, maxSurface);
      const reReleaseIntensity = normalize(rr, maxReRelease);
      const waterIntensity = normalize(water, maxWater);
      const avgAge = base.plumeAge[idx] / Math.max(0.001, value);
      const detectionProbability = clamp(intensity * (1 - uncertainty * 0.55) * (1 - (settings.contamination ?? 0) * 0.28), 0, 1);
      const [lon, lat] = localToLonLat(x, y, settings.lat, settings.lon);
      const layer = waterIntensity > Math.max(groundIntensity, airIntensity, drainageIntensity, surfaceIntensity) * 0.82 ? "water" : d > g * 0.58 && d > a * 0.42 ? "drainage" : surfaceIntensity > groundIntensity * 0.92 && surfaceIntensity > airIntensity * 0.7 ? "surface" : a > g * 0.86 ? "air" : "ground";

      cells.push({ lon, lat, intensity, ground: groundIntensity, air: airIntensity, drainage: drainageIntensity, surfaceDeposit: surfaceIntensity, reRelease: reReleaseIntensity, plumeAge: avgAge, detectionProbability, waterSignal: waterIntensity, uncertainty, outsideRadius, layer });
      if (!outsideRadius) {
        active += 1;
        total += intensity;
        totalUncertainty += uncertainty;
        groundTotal += g;
        airTotal += a;
        drainageTotal += d;
        surfaceTotal += sfc;
        reReleaseTotal += rr;
        waterTotal += water;
        if (intensity > 0.46 && uncertainty > 0.28) pockets += 1;
      }
    }
  }

  const signal = buildSignal(settings).map((point) => ({ hour: point.hour, value: clamp(point.max / Math.max(max, 0.001), 0, 1) }));

  const cellsInRadius = Math.PI * (analysisRadius / base.step) * (analysisRadius / base.step);
  const detectability = clamp(max / Math.max(0.0001, settings.sourceStrength * 9.5), 0, 1);
  const coverage = clamp(active / cellsInRadius, 0, 1);
  const continuity = clamp((total / Math.max(1, active)) * (1 - settings.contamination * 0.34) * (settings.stability * 0.25 + 0.82) * 1.9, 0, 1);
  const uncertainty = clamp(totalUncertainty / Math.max(1, active), 0, 1);
  const layerTotal = Math.max(0.001, groundTotal + airTotal + drainageTotal + surfaceTotal + reReleaseTotal + waterTotal);

  const visibleObstacles = base.obstacles.map((item) => ({ lon: item.lon, lat: item.lat, type: item.type, size: item.size }));
  const explanationParts = [];
  if (weather.windSpeed > 5.8) explanationParts.push("fast wind advects particles farther and thins the ground layer");
  else if (weather.windSpeed < 1.4) explanationParts.push("light air leaves a compact, pooled particle field");
  else explanationParts.push("moderate wind produces a usable but still broken transport field");
  if (weather.source === "live-grid") explanationParts.push(`${weather.sampleCount} live weather samples create a local interpolated wind field`);
  if (settings.stability > 0.62) explanationParts.push("stable air favors settling and persistent low odor");
  else if (settings.stability < 0.32) explanationParts.push("unstable air increases vertical mixing and uncertainty");
  if (settings.canopy > 0.45) explanationParts.push("canopy slows wind and increases ground retention");
  if ((base.environment?.avgMoisture ?? 0) > 0.08) explanationParts.push("mapped low/moist land-cover pockets increase local scent holding");
  if ((base.environment?.avgImpervious ?? 0) > 0.08) explanationParts.push("impervious roads and structures increase drying, lift, and dilution");
  if (rawEnvironment?.buildings?.features?.length) explanationParts.push("mapped homes/buildings block flow and create edge wake pockets");
  if (settings.buildingMode === "obstruction") explanationParts.push("obstruction mode treats homes as stronger footprint blockers");
  if (settings.buildingMode === "wake") explanationParts.push("wake mode emphasizes edge turbulence and downwind scent pockets");
  if (settings.buildingMode === "shade") explanationParts.push("shade mode increases persistent low scent around building edges");
  if (rawEnvironment?.stormwater?.counts) explanationParts.push("mapped stormwater inlets, mains, channels, ponds, and basins shape rain-driven scent transport");
  if (settings.drainage > 0.45 && settings.rain > 0.25) explanationParts.push("rain and drainage shift part of the signal into stormwater network corridors");
  if ((settings.trailAgeHours ?? 0) > 6) explanationParts.push("older trail age broadens and fragments the detectable corridor");
  if ((settings.sourceAgeHours ?? 0) > 12 && settings.sourceType !== "moving-live") explanationParts.push("continuing source age replenishes odor while chemistry and surface deposition change");
  if ((settings.rereleaseRate ?? 0) > 0.35) explanationParts.push("surface-deposited odor can re-release under warming, drying, and airflow");
  if (settings.waterEnabled || settings.sourceType === "submerged") explanationParts.push("submerged-source mode separates underwater transport, surface emergence, and airborne detection");
  if (settings.contamination > 0.45) explanationParts.push("contamination lowers path continuity and raises false-pocket risk");

  const assumptions = [
    "local meter grid",
    `${Math.round(domainRadius)} m expanded solver domain`,
    "selected radius is metric scale, not plume edge",
    "particle/puff transport",
    "ground + nose-height + deposited scent layers",
    `${settings.sourceType ?? "moving-live"} source type`,
    `${Math.round(settings.sourceAgeHours ?? settings.trackAge ?? 0)} h source age`,
    `${Math.round(settings.trailAgeHours ?? settings.trackAge ?? 0)} h trail age`,
    `${(settings.plumeAgeHours ?? 1).toFixed(1)} h plume-age window`,
    `${(settings.chambers ?? []).filter((chamber) => chamber.active).length} chamber odor beacons`,
    "per-station vent/leak/age/recharge",
    "OSM roads + county buildings/canopy",
    "City stormwater network",
    "impervious/moisture/low-point land-cover raster",
    `${settings.buildingMode} building mode`,
    "wind sensitivity ensemble",
    quick ? "fast motion uncertainty proxy" : "full uncertainty ensemble",
    "cached weather-score daily signal",
    weather.source === "live-grid" ? "Open-Meteo local weather grid" : "manual weather baseline",
    settings.weatherGrid?.historyHours ? `${Math.round(settings.weatherGrid.historyHours)} h weather-history request` : "weather history approximated from current cycle",
    settings.waterEnabled || settings.sourceType === "submerged" ? "underwater/surface/air water pathway" : "land-source pathway",
    "obstacle wake/channeling",
    "illustrative coefficients",
  ];

  return {
    cells,
    vectors: buildVectors(settings, time, base),
    dogPath: buildDogPath(settings, time, base),
    obstacles: visibleObstacles,
    chambers: buildChamberResults(settings, base),
    waterZones: base.waterZones.map((zone) => {
      const [lon, lat] = localToLonLat(zone.x, zone.y, settings.lat, settings.lon);
      return { lon, lat, intensity: clamp(zone.intensity, 0, 1), uncertainty: clamp(zone.uncertainty, 0, 1), stage: zone.stage };
    }),
    signal,
    metrics: {
      detectability,
      coverage,
      continuity,
      pockets,
      max,
      uncertainty,
      groundHold: groundTotal / layerTotal,
      airborne: airTotal / layerTotal,
      drainageLoad: drainageTotal / layerTotal,
      surfaceLoad: surfaceTotal / layerTotal,
      reReleaseLoad: reReleaseTotal / layerTotal,
      waterSignal: waterTotal / layerTotal,
    },
    weather: {
      windDir: weather.windDir,
      windSpeed: weather.windSpeed,
      windGust: weather.windGust,
      temperature: weather.temperature,
      humidity: weather.humidity,
      rain: weather.rain,
      source: weather.source,
      sampleCount: weather.sampleCount,
    },
    assumptions,
    explanation: explanationParts.join("; ") + ".",
  };
}

self.onmessage = (event) => {
  if (event.data.environment) {
    rawEnvironment = event.data.environment;
    environmentRasterCache = new Map();
    environmentModelCache = new Map();
    signalCache = null;
    return;
  }
  const { settings, time, requestId, quick } = event.data;
  self.postMessage({ ...buildField(settings, time, { quick }), requestId });
};
