"use client";

import { MapboxOverlay } from "@deck.gl/mapbox";
import { ColumnLayer, GeoJsonLayer, LineLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { circle } from "@turf/turf";
import * as d3 from "d3";
import {
  CloudRain,
  Droplets,
  Gauge,
  Layers,
  MapPin,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ThermometerSun,
  Trash2,
  Wind,
} from "lucide-react";
import maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChamberTwinPanel } from "@/components/chamber-twin-panel";
import { createPlacedChamber, stationLabel } from "@/lib/chamber-twin/defaults";
import { buildChamberTwins } from "@/lib/chamber-twin/simulator";
import type { ChamberCoverageStatus, ChamberTwin, ScentChamber } from "@/lib/chamber-twin/types";

type Basemap = "street" | "satellite";
type Surface = "grass" | "forest" | "soil" | "pavement" | "mixed";
type ScentView = "combined" | "ground" | "air" | "drainage" | "surface" | "rerelease" | "water" | "uncertainty";
type BuildingMode = "normal" | "obstruction" | "wake" | "shade";
type WeatherSource = "live" | "manual";
type SourceType = "moving-live" | "stationary-live" | "training-aid" | "animal" | "decomposition" | "submerged";
type DecompositionStage = "none" | "fresh" | "active" | "advanced";
type WaterBodyType = "retention-basin" | "pond" | "lake" | "river" | "canal" | "ocean";
type ControlTab = "map" | "chambers" | "conditions" | "output";

type LayerToggles = {
  odor: boolean;
  uncertainty: boolean;
  radius: boolean;
  buildings: boolean;
  roads: boolean;
  stormwater: boolean;
  canopy: boolean;
  chambers: boolean;
  water: boolean;
  wind: boolean;
  dogPath: boolean;
};

type GeoJsonFeature = {
  type: "Feature";
  properties: {
    [key: string]: string | number | boolean | null | undefined;
    id?: string;
    name?: string;
    title?: string;
    detail?: string;
    highway?: string;
    kind?: string;
    surface?: string;
    building?: string;
    heightMeters?: number;
  };
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Polygon"; coordinates: [number, number][][] }
    | { type: "Point"; coordinates: [number, number] };
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type StormwaterData = {
  source: string;
  sourceUrl: string;
  webMapUrl: string;
  fetchedAt: string;
  queryRadiusMeters: number;
  disclaimer: string;
  counts?: Record<string, number>;
  manholes: FeatureCollection;
  networkStructures: FeatureCollection;
  endStructures: FeatureCollection;
  cleanOuts: FeatureCollection;
  dropInlets: FeatureCollection;
  stormBasins: FeatureCollection;
  pumps: FeatureCollection;
  virtualEnds: FeatureCollection;
  gravityMains: FeatureCollection;
  openChannels: FeatureCollection;
  virtualMains: FeatureCollection;
  stormPonds: FeatureCollection;
  stormStructures: FeatureCollection;
};

type EnvironmentData = {
  source: string;
  generatedAt: string;
  bounds?: EnvironmentBounds;
  coverageSource?: string;
  radiusMeters: number;
  roads: FeatureCollection;
  buildings: FeatureCollection;
  canopy: FeatureCollection;
  trees: FeatureCollection;
  stormwater?: StormwaterData;
};

type EnvironmentBounds = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

type EnvironmentCoverage = {
  bounds: EnvironmentBounds | null;
  requiredBounds: EnvironmentBounds;
  needsRefresh: boolean;
  score: number;
  message: string;
  stationStatuses: Record<string, ChamberCoverageStatus>;
  missingLayers: string[];
};

type Settings = {
  lat: number;
  lon: number;
  radius: number;
  basemap: Basemap;
  windDir: number;
  windSpeed: number;
  gustiness: number;
  temperature: number;
  humidity: number;
  rain: number;
  sunlight: number;
  trackAge: number;
  sourceAgeHours: number;
  trailAgeHours: number;
  plumeAgeHours: number;
  sourceType: SourceType;
  decompositionStage: DecompositionStage;
  airborneLossRate: number;
  surfaceDepositionRate: number;
  chemicalChangeRate: number;
  rereleaseRate: number;
  waterEnabled: boolean;
  waterBodyType: WaterBodyType;
  waterDepth: number;
  waterCurrentDir: number;
  waterCurrentSpeed: number;
  verticalMixing: number;
  waveAction: number;
  waterTurbulence: number;
  sourceBuoyancy: number;
  salinity: number;
  sourceFixed: boolean;
  contamination: number;
  surface: Surface;
  stability: number;
  canopy: number;
  roughness: number;
  drainage: number;
  sourceStrength: number;
  buildingMode: BuildingMode;
  weatherSource: WeatherSource;
  chambers: ScentChamber[];
};

type WeatherSample = {
  id: string;
  lat: number;
  lon: number;
  x: number;
  y: number;
  current: {
    time: string;
    windSpeed: number;
    windDir: number;
    windGust: number;
    temperature: number;
    humidity: number;
    precipitation: number;
  };
  hourly: {
    time: string[];
    windSpeed: number[];
    windDir: number[];
    windGust: number[];
    temperature: number[];
    humidity: number[];
    precipitation: number[];
  };
};

type WeatherGrid = {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  center: { lat: number; lon: number };
  sampleRadiusMeters: number;
  historyHours: number;
  samples: WeatherSample[];
};

type Cell = {
  lon: number;
  lat: number;
  intensity: number;
  uncertainty: number;
  ground: number;
  air: number;
  drainage: number;
  surfaceDeposit: number;
  reRelease: number;
  plumeAge: number;
  detectionProbability: number;
  waterSignal: number;
  outsideRadius?: boolean;
  layer: "ground" | "air" | "drainage" | "surface" | "water";
};

type Vector = {
  from: [number, number];
  to: [number, number];
  strength: number;
};

type Obstacle = {
  lon: number;
  lat: number;
  type: "building" | "tree" | "drainage" | "road";
  size: number;
};

type ChamberResult = ScentChamber & {
  coverage: number;
};

type WaterScentZone = {
  lon: number;
  lat: number;
  intensity: number;
  uncertainty: number;
  stage: "underwater" | "surface" | "airborne";
};

type MapIndicator = {
  id: string;
  label: string;
  title: string;
  detail: string;
  lon: number;
  lat: number;
  radius: number;
  elevation: number;
  color: [number, number, number, number];
};

type SignalPoint = {
  hour: number;
  value: number;
};

type FieldResult = {
  cells: Cell[];
  vectors: Vector[];
  dogPath: [number, number][];
  obstacles: Obstacle[];
  chambers: ChamberResult[];
  signal: SignalPoint[];
  metrics: {
    detectability: number;
    coverage: number;
    continuity: number;
    pockets: number;
    max: number;
    uncertainty: number;
    groundHold: number;
    airborne: number;
    drainageLoad: number;
    surfaceLoad: number;
    reReleaseLoad: number;
    waterSignal: number;
  };
  weather: {
    windDir: number;
    windSpeed: number;
    windGust?: number;
    temperature: number;
    humidity: number;
    rain?: number;
    source?: string;
    sampleCount?: number;
  };
  waterZones: WaterScentZone[];
  assumptions: string[];
  explanation: string;
};

const DEFAULTS: Settings = {
  lat: 29.612704,
  lon: -82.442313,
  radius: 500,
  basemap: "satellite",
  windDir: 72,
  windSpeed: 3.2,
  gustiness: 0.42,
  temperature: 68,
  humidity: 62,
  rain: 0.12,
  sunlight: 0.55,
  trackAge: 5,
  sourceAgeHours: 5,
  trailAgeHours: 3,
  plumeAgeHours: 1.4,
  sourceType: "moving-live",
  decompositionStage: "none",
  airborneLossRate: 0.34,
  surfaceDepositionRate: 0.42,
  chemicalChangeRate: 0.18,
  rereleaseRate: 0.28,
  waterEnabled: false,
  waterBodyType: "retention-basin",
  waterDepth: 2.4,
  waterCurrentDir: 118,
  waterCurrentSpeed: 0.18,
  verticalMixing: 0.42,
  waveAction: 0.28,
  waterTurbulence: 0.36,
  sourceBuoyancy: 0.5,
  salinity: 0,
  sourceFixed: true,
  contamination: 0.18,
  surface: "mixed",
  stability: 0.46,
  canopy: 0.28,
  roughness: 0.38,
  drainage: 0.24,
  sourceStrength: 0.72,
  buildingMode: "normal",
  weatherSource: "live",
  chambers: [
    {
      id: "sw44",
      name: "Station A",
      road: "SW 44th Ave",
      lat: 29.612969,
      lon: -82.4464065,
      scentStrength: 0.82,
      foodStrength: 0.38,
      ventHeight: 0.72,
      ventDirection: 84,
      leakRate: 0.72,
      itemAge: 9,
      rechargeHours: 18,
      detectionRadius: 38,
      active: true,
      preset: "food-scent-hybrid",
      scentArticle: "blanket",
      foodLevel: 0.82,
      batteryCharge: 0.86,
      solarExposure: 0.72,
      internalHumidityBias: 0.03,
      lastServiceHour: 11,
    },
    {
      id: "sw91",
      name: "Station B",
      road: "SW 91st Dr",
      lat: 29.6130943,
      lon: -82.4397083,
      scentStrength: 0.76,
      foodStrength: 0.44,
      ventHeight: 0.72,
      ventDirection: 255,
      leakRate: 0.64,
      itemAge: 14,
      rechargeHours: 24,
      detectionRadius: 42,
      active: true,
      preset: "vented-tote",
      scentArticle: "clothing",
      foodLevel: 0.68,
      batteryCharge: 0.78,
      solarExposure: 0.58,
      internalHumidityBias: 0.02,
      lastServiceHour: 10,
    },
  ],
};

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const WORKER_VERSION = "terrain-station-v13";
const ALACHUA_BUILDINGS_URL = "https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/Alachua_County_FL_Buildings/FeatureServer/0/query";
const GAINESVILLE_STORMWATER_URL = "https://services2.arcgis.com/Zzhtlau4ccHkQgTu/arcgis/rest/services/StormwaterNetwork_AGO/FeatureServer";
const ENVIRONMENT_REFRESH_PADDING_METERS = 360;

const STORMWATER_LAYER_CONFIG: {
  key: keyof Pick<
    StormwaterData,
    | "manholes"
    | "networkStructures"
    | "endStructures"
    | "cleanOuts"
    | "dropInlets"
    | "stormBasins"
    | "pumps"
    | "virtualEnds"
    | "gravityMains"
    | "openChannels"
    | "virtualMains"
    | "stormPonds"
    | "stormStructures"
  >;
  id: number;
  kind: string;
  title: string;
}[] = [
  { key: "manholes", id: 0, kind: "manhole", title: "Stormwater manhole" },
  { key: "networkStructures", id: 1, kind: "network-structure", title: "Stormwater network structure" },
  { key: "endStructures", id: 2, kind: "outfall", title: "Stormwater end structure" },
  { key: "cleanOuts", id: 3, kind: "cleanout", title: "Stormwater cleanout" },
  { key: "dropInlets", id: 4, kind: "inlet", title: "Stormwater drop inlet" },
  { key: "stormBasins", id: 5, kind: "basin", title: "Stormwater basin" },
  { key: "pumps", id: 6, kind: "pump", title: "Stormwater pump" },
  { key: "virtualEnds", id: 7, kind: "virtual-end", title: "Stormwater virtual end" },
  { key: "gravityMains", id: 8, kind: "pipe", title: "Stormwater gravity main" },
  { key: "openChannels", id: 9, kind: "channel", title: "Stormwater open channel" },
  { key: "virtualMains", id: 10, kind: "virtual-pipe", title: "Stormwater virtual main" },
  { key: "stormPonds", id: 11, kind: "pond", title: "Stormwater pond/feature" },
  { key: "stormStructures", id: 12, kind: "structure", title: "Stormwater structure polygon" },
];

function offsetPoint(lat: number, lon: number, eastMeters: number, northMeters: number) {
  const nextLat = lat + (northMeters / 6371000) / (Math.PI / 180);
  const nextLon = lon + (eastMeters / (6371000 * Math.cos(lat * (Math.PI / 180)))) / (Math.PI / 180);
  return { lat: nextLat, lon: nextLon };
}

function localMetersBetween(lon: number, lat: number, centerLat: number, centerLon: number) {
  const x = 6371000 * Math.cos(centerLat * (Math.PI / 180)) * (lon - centerLon) * (Math.PI / 180);
  const y = 6371000 * (lat - centerLat) * (Math.PI / 180);
  return { x, y, distance: Math.hypot(x, y) };
}

function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function extendBounds(bounds: EnvironmentBounds | null, lon: number, lat: number): EnvironmentBounds {
  if (!bounds) return { minLon: lon, minLat: lat, maxLon: lon, maxLat: lat };
  return {
    minLon: Math.min(bounds.minLon, lon),
    minLat: Math.min(bounds.minLat, lat),
    maxLon: Math.max(bounds.maxLon, lon),
    maxLat: Math.max(bounds.maxLat, lat),
  };
}

function extendBoundsWithFeature(bounds: EnvironmentBounds | null, feature: GeoJsonFeature): EnvironmentBounds | null {
  const visit = (coordinates: unknown, current: EnvironmentBounds | null): EnvironmentBounds | null => {
    if (!Array.isArray(coordinates)) return current;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      return extendBounds(current, Number(coordinates[0]), Number(coordinates[1]));
    }
    let next = current;
    for (const child of coordinates) next = visit(child, next);
    return next;
  };
  return visit(feature.geometry.coordinates, bounds);
}

function collectionBounds(collections: (FeatureCollection | undefined)[]): EnvironmentBounds | null {
  let bounds: EnvironmentBounds | null = null;
  for (const collection of collections) {
    for (const feature of collection?.features ?? []) {
      bounds = extendBoundsWithFeature(bounds, feature);
    }
  }
  return bounds;
}

function environmentFeatureBounds(environment: EnvironmentData | null): EnvironmentBounds | null {
  if (!environment) return null;
  if (environment.bounds) return environment.bounds;
  return collectionBounds([
    environment.roads,
    environment.buildings,
    environment.canopy,
    environment.trees,
    environment.stormwater?.manholes,
    environment.stormwater?.networkStructures,
    environment.stormwater?.endStructures,
    environment.stormwater?.cleanOuts,
    environment.stormwater?.dropInlets,
    environment.stormwater?.stormBasins,
    environment.stormwater?.gravityMains,
    environment.stormwater?.openChannels,
    environment.stormwater?.virtualMains,
    environment.stormwater?.stormPonds,
    environment.stormwater?.stormStructures,
  ]);
}

function padBounds(bounds: EnvironmentBounds, centerLat: number, meters: number): EnvironmentBounds {
  if (meters === 0) return bounds;
  const latDelta = (meters / 6371000) / (Math.PI / 180);
  const lonDelta = (meters / (6371000 * Math.cos(centerLat * (Math.PI / 180)))) / (Math.PI / 180);
  return {
    minLon: bounds.minLon - lonDelta,
    minLat: bounds.minLat - latDelta,
    maxLon: bounds.maxLon + lonDelta,
    maxLat: bounds.maxLat + latDelta,
  };
}

function requiredEnvironmentBounds(settings: Settings, chambers: ScentChamber[]): EnvironmentBounds {
  let bounds = extendBounds(null, settings.lon, settings.lat);
  for (const chamber of chambers) {
    if (!chamber.active) continue;
    bounds = extendBounds(bounds, chamber.lon, chamber.lat);
  }
  return padBounds(bounds, settings.lat, settings.radius + ENVIRONMENT_REFRESH_PADDING_METERS);
}

function boundsContains(outer: EnvironmentBounds | null, inner: EnvironmentBounds, paddingMeters: number, centerLat: number) {
  if (!outer) return false;
  const padded = padBounds(outer, centerLat, -paddingMeters);
  return padded.minLon <= inner.minLon && padded.minLat <= inner.minLat && padded.maxLon >= inner.maxLon && padded.maxLat >= inner.maxLat;
}

function pointBoundsStatus(bounds: EnvironmentBounds | null, lon: number, lat: number, centerLat: number): ChamberCoverageStatus {
  if (!bounds) return "sparse";
  if (lon < bounds.minLon || lon > bounds.maxLon || lat < bounds.minLat || lat > bounds.maxLat) return "sparse";
  const west = localMetersBetween(bounds.minLon, lat, centerLat, lon).distance;
  const east = localMetersBetween(bounds.maxLon, lat, centerLat, lon).distance;
  const south = localMetersBetween(lon, bounds.minLat, centerLat, lon).distance;
  const north = localMetersBetween(lon, bounds.maxLat, centerLat, lon).distance;
  return Math.min(west, east, south, north) < 140 ? "edge" : "mapped";
}

function layerBounds(environment: EnvironmentData | null) {
  return {
    roads: collectionBounds([environment?.roads]),
    buildings: collectionBounds([environment?.buildings]),
    canopy: collectionBounds([environment?.canopy, environment?.trees]),
    stormwater: collectionBounds([
      environment?.stormwater?.manholes,
      environment?.stormwater?.networkStructures,
      environment?.stormwater?.endStructures,
      environment?.stormwater?.dropInlets,
      environment?.stormwater?.stormBasins,
      environment?.stormwater?.gravityMains,
      environment?.stormwater?.openChannels,
      environment?.stormwater?.virtualMains,
      environment?.stormwater?.stormPonds,
      environment?.stormwater?.stormStructures,
    ]),
  };
}

function evaluateEnvironmentCoverage(environment: EnvironmentData | null, settings: Settings, chambers: ScentChamber[]): EnvironmentCoverage {
  const bounds = environmentFeatureBounds(environment);
  const requiredBounds = requiredEnvironmentBounds(settings, chambers);
  const missingLayers = Object.entries(layerBounds(environment))
    .filter(([, layer]) => !boundsContains(layer, requiredBounds, 0, settings.lat))
    .map(([key]) => key);
  const stationStatuses: Record<string, ChamberCoverageStatus> = {};
  for (const chamber of chambers) stationStatuses[chamber.id] = pointBoundsStatus(bounds, chamber.lon, chamber.lat, settings.lat);
  const contains = boundsContains(bounds, requiredBounds, 0, settings.lat);
  const score = contains ? (missingLayers.length ? 0.72 : 1) : 0.38;
  const message = contains
    ? missingLayers.length
      ? `Environment envelope covers stations; sparse layers: ${missingLayers.join(", ")}.`
      : "Environment envelope covers the active station layout."
    : "Station layout extends beyond the loaded environment envelope.";
  return { bounds, requiredBounds, needsRefresh: !contains || missingLayers.includes("buildings") || missingLayers.includes("stormwater"), score, message, stationStatuses, missingLayers };
}

function boundsKey(bounds: EnvironmentBounds) {
  return [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].map((value) => value.toFixed(5)).join(":");
}

function mergeFeatureCollections(...collections: (FeatureCollection | undefined)[]): FeatureCollection {
  const seen = new Set<string>();
  const features: GeoJsonFeature[] = [];
  for (const collection of collections) {
    for (const feature of collection?.features ?? []) {
      const key = String(feature.properties?.id ?? `${feature.geometry.type}:${JSON.stringify(feature.geometry.coordinates).slice(0, 220)}`);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
    }
  }
  return { type: "FeatureCollection", features };
}

function normalizeBuildingFeatures(collection: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features
      .filter((feature) => feature.geometry?.type === "Polygon")
      .map((feature) => {
        const objectId = feature.properties?.OBJECTID ?? feature.properties?.objectId ?? feature.properties?.id;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            id: `alachua-building-${objectId}`,
            objectId,
            building: "yes",
            source: "esri_AlachuaCountyFL",
            title: "Alachua County building footprint",
            detail: "County building polygon. Modeled as a physical airflow obstruction with edge wake, shade, and scent pooling effects.",
            heightMeters: Number(feature.properties?.heightMeters ?? 5.5),
          },
        };
      }),
  };
}

function normalizeStormwaterFeatures(collection: FeatureCollection, kind: string, title: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => {
      const facilityId = feature.properties?.FACILITYID ?? feature.properties?.FacilityID ?? feature.properties?.OBJECTID ?? feature.properties?.id;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          id: `${kind}-${facilityId}`,
          kind,
          title,
          detail: `${title}${facilityId ? ` ${facilityId}` : ""}. Source: City stormwater network.`,
        },
      };
    }),
  };
}

async function fetchArcgisGeojson(url: string, bounds: EnvironmentBounds, signal?: AbortSignal): Promise<FeatureCollection> {
  const params = new URLSearchParams({
    f: "geojson",
    where: "1=1",
    geometry: `${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    outSR: "4326",
    resultRecordCount: "2000",
  });
  const response = await fetch(`${url}?${params}`, { signal });
  if (!response.ok) throw new Error(`environment request failed: ${response.status}`);
  const payload = await response.json();
  return payload?.type === "FeatureCollection" ? payload : emptyFeatureCollection();
}

async function fetchExpandedEnvironment(baseEnvironment: EnvironmentData, requiredBounds: EnvironmentBounds, signal?: AbortSignal): Promise<EnvironmentData> {
  const buildings = normalizeBuildingFeatures(await fetchArcgisGeojson(ALACHUA_BUILDINGS_URL, requiredBounds, signal));
  const stormwaterEntries = await Promise.all(
    STORMWATER_LAYER_CONFIG.map(async (layer) => {
      const collection = await fetchArcgisGeojson(`${GAINESVILLE_STORMWATER_URL}/${layer.id}/query`, requiredBounds, signal);
      return [layer.key, normalizeStormwaterFeatures(collection, layer.kind, layer.title)] as const;
    }),
  );
  const stormwaterCollections = Object.fromEntries(stormwaterEntries) as Pick<
    StormwaterData,
    | "manholes"
    | "networkStructures"
    | "endStructures"
    | "cleanOuts"
    | "dropInlets"
    | "stormBasins"
    | "pumps"
    | "virtualEnds"
    | "gravityMains"
    | "openChannels"
    | "virtualMains"
    | "stormPonds"
    | "stormStructures"
  >;
  const counts = Object.fromEntries(Object.entries(stormwaterCollections).map(([key, collection]) => [key, collection.features.length]));
  return {
    ...baseEnvironment,
    source: `${baseEnvironment.source}; dynamic Alachua County buildings and Gainesville stormwater refresh`,
    generatedAt: new Date().toISOString(),
    bounds: requiredBounds,
    coverageSource: "dynamic-expanded",
    radiusMeters: Math.max(baseEnvironment.radiusMeters ?? 0, Math.round(localMetersBetween(requiredBounds.maxLon, requiredBounds.maxLat, requiredBounds.minLat, requiredBounds.minLon).distance)),
    buildings: mergeFeatureCollections(baseEnvironment.buildings, buildings),
    stormwater: {
      ...(baseEnvironment.stormwater ?? {
        source: "City of Gainesville StormwaterNetwork_AGO FeatureServer",
        sourceUrl: GAINESVILLE_STORMWATER_URL,
        webMapUrl: "https://gainesvillefl.maps.arcgis.com/home/item.html?id=f2601adc58c84daf9505a8e3076b7152",
        fetchedAt: new Date().toISOString(),
        queryRadiusMeters: 0,
        disclaimer: "Dynamic local environment refresh.",
      }),
      fetchedAt: new Date().toISOString(),
      queryRadiusMeters: Math.round(localMetersBetween(requiredBounds.maxLon, requiredBounds.maxLat, requiredBounds.minLat, requiredBounds.minLon).distance),
      counts,
      ...stormwaterCollections,
    },
  };
}

function weatherSamplePoints(settings: Settings) {
  const span = clamp(settings.radius * 1.25, 350, 1400);
  return [-span, 0, span].flatMap((north) =>
    [-span, 0, span].map((east) => {
      const point = offsetPoint(settings.lat, settings.lon, east, north);
      return { ...point, x: east, y: north, id: `${Math.round(east)}:${Math.round(north)}` };
    }),
  );
}

function numericSeries(values: unknown): number[] {
  return Array.isArray(values) ? values.map((value) => Number(value) || 0) : [];
}

async function fetchWeatherGrid(settings: Settings, signal?: AbortSignal): Promise<WeatherGrid> {
  const samples = weatherSamplePoints(settings);
  const historyHours = Math.max(settings.sourceAgeHours, settings.trailAgeHours, settings.plumeAgeHours, settings.trackAge);
  const pastDays = String(clamp(Math.ceil((historyHours + 6) / 24), 1, 7));
  const params = new URLSearchParams({
    latitude: samples.map((point) => point.lat.toFixed(6)).join(","),
    longitude: samples.map((point) => point.lon.toFixed(6)).join(","),
    current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation",
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation",
    wind_speed_unit: "ms",
    temperature_unit: "fahrenheit",
    timezone: "America/New_York",
    past_days: pastDays,
    forecast_days: "2",
  });
  const sourceUrl = `https://api.open-meteo.com/v1/forecast?${params}`;
  const response = await fetch(sourceUrl, { signal });
  if (!response.ok) throw new Error(`weather request failed: ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [payload];
  return {
    source: "Open-Meteo Forecast API",
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    center: { lat: settings.lat, lon: settings.lon },
    sampleRadiusMeters: clamp(settings.radius * 1.25, 350, 1400),
    historyHours,
    samples: rows.map((row, index) => ({
      id: samples[index]?.id ?? `sample-${index}`,
      lat: samples[index]?.lat ?? Number(row.latitude),
      lon: samples[index]?.lon ?? Number(row.longitude),
      x: samples[index]?.x ?? 0,
      y: samples[index]?.y ?? 0,
      current: {
        time: String(row.current?.time ?? ""),
        windSpeed: Number(row.current?.wind_speed_10m ?? settings.windSpeed),
        windDir: Number(row.current?.wind_direction_10m ?? settings.windDir),
        windGust: Number(row.current?.wind_gusts_10m ?? settings.windSpeed),
        temperature: Number(row.current?.temperature_2m ?? settings.temperature),
        humidity: Number(row.current?.relative_humidity_2m ?? settings.humidity),
        precipitation: Number(row.current?.precipitation ?? 0),
      },
      hourly: {
        time: Array.isArray(row.hourly?.time) ? row.hourly.time.map(String) : [],
        windSpeed: numericSeries(row.hourly?.wind_speed_10m),
        windDir: numericSeries(row.hourly?.wind_direction_10m),
        windGust: numericSeries(row.hourly?.wind_gusts_10m),
        temperature: numericSeries(row.hourly?.temperature_2m),
        humidity: numericSeries(row.hourly?.relative_humidity_2m),
        precipitation: numericSeries(row.hourly?.precipitation),
      },
    })),
  };
}

function styleUrl(basemap: Basemap) {
  const style = basemap === "satellite" ? "satellite" : "basic-v2";
  return `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`;
}

function hourLabel(hour: number) {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function odorColor(intensity: number): [number, number, number, number] {
  if (intensity > 0.78) return [245, 83, 61, 210];
  if (intensity > 0.52) return [250, 172, 48, 178];
  if (intensity > 0.3) return [239, 220, 87, 142];
  if (intensity > 0.16) return [78, 190, 146, 110];
  return [63, 136, 216, 82];
}

function layerColor(cell: Cell): [number, number, number, number] {
  const [r, g, b, a] = odorColor(cell.intensity);
  if (cell.layer === "air") return [r, g, b, Math.max(46, a - 44)];
  if (cell.layer === "drainage") return [43, 126, 170, Math.max(80, a - 18)];
  return [r, g, b, a];
}

function finiteLayerValue(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function scentValue(cell: Cell, view: ScentView) {
  const intensity = finiteLayerValue(cell.intensity);
  if (view === "ground") return finiteLayerValue(cell.ground, cell.layer === "ground" ? intensity : 0);
  if (view === "air") return finiteLayerValue(cell.air, cell.layer === "air" ? intensity : 0);
  if (view === "drainage") return finiteLayerValue(cell.drainage, cell.layer === "drainage" ? intensity : 0);
  if (view === "surface") return finiteLayerValue(cell.surfaceDeposit, cell.layer === "surface" ? intensity : 0);
  if (view === "rerelease") return finiteLayerValue(cell.reRelease);
  if (view === "water") return finiteLayerValue(cell.waterSignal, cell.layer === "water" ? intensity : 0);
  if (view === "uncertainty") return finiteLayerValue(cell.uncertainty) * clamp(intensity * 1.25, 0, 1);
  return intensity;
}

function scentThreshold(view: ScentView, radius: number) {
  const radiusScale = radius >= 1000 ? 0.28 : radius >= 750 ? 0.58 : 1;
  if (view === "uncertainty") return 0.12 * radiusScale;
  if (view === "drainage") return 0.018 * radiusScale;
  if (view === "surface" || view === "rerelease") return 0.02 * radiusScale;
  if (view === "water") return 0.016 * radiusScale;
  return 0.025 * radiusScale;
}

function scentColor(cell: Cell, view: ScentView): [number, number, number, number] {
  const fade = cell.outsideRadius ? 0.42 : 1;
  if (view === "uncertainty") {
    const value = scentValue(cell, view);
    if (value > 0.72) return [245, 83, 61, Math.round(178 * fade)];
    if (value > 0.45) return [242, 184, 75, Math.round(150 * fade)];
    return [63, 136, 216, Math.round(96 * fade)];
  }
  if (view === "ground") {
    const [r, g, b, a] = odorColor(scentValue(cell, view));
    return [r, g, b, Math.round(a * fade)];
  }
  if (view === "air") {
    const [r, g, b, a] = odorColor(scentValue(cell, view));
    return [r, g, b, Math.round(Math.max(54, a - 38) * fade)];
  }
  if (view === "drainage") return [43, 126, 170, Math.round(Math.max(72, Math.round(80 + scentValue(cell, view) * 130)) * fade)];
  if (view === "surface") return [99, 128, 83, Math.round(Math.max(58, 78 + scentValue(cell, view) * 122) * fade)];
  if (view === "rerelease") return [166, 103, 68, Math.round(Math.max(62, 86 + scentValue(cell, view) * 118) * fade)];
  if (view === "water") return [31, 114, 181, Math.round(Math.max(68, 84 + scentValue(cell, view) * 135) * fade)];
  const [r, g, b, a] = layerColor(cell);
  return [r, g, b, Math.round(a * fade)];
}

function tooltipHtml(title: string, detail: string) {
  return `<div class="deck-tooltip-title">${title}</div><div class="deck-tooltip-detail">${detail}</div>`;
}

function stationCoverageLabel(status: ChamberCoverageStatus | undefined) {
  if (status === "sparse") return "sparse data";
  if (status === "edge") return "edge data";
  return "mapped";
}

function stationCoverageClass(status: ChamberCoverageStatus | undefined) {
  if (status === "sparse") return "sparse";
  if (status === "edge") return "edge";
  return "mapped";
}

function Metric({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {Math.round(value)}
        {suffix}
      </strong>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  icon,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  icon: React.ReactNode;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span className="control-top">
        <span className="control-label">
          {icon}
          {label}
        </span>
        <strong>
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(1)}
          {suffix}
        </strong>
      </span>
      <input
        min={min}
        max={max}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function SignalChart({ signal, time }: { signal: SignalPoint[]; time: number }) {
  const width = 360;
  const height = 112;
  const path = useMemo(() => {
    const x = d3.scaleLinear().domain([0, 24]).range([12, width - 12]);
    const y = d3.scaleLinear().domain([0, 1]).range([height - 22, 14]);
    const line = d3
      .line<SignalPoint>()
      .x((point) => x(point.hour))
      .y((point) => y(point.value))
      .curve(d3.curveCatmullRom.alpha(0.5));
    return {
      d: line(signal) ?? "",
      xNow: x(time),
      yNow: y(signal[Math.min(signal.length - 1, Math.round(time))]?.value ?? 0),
    };
  }, [signal, time]);

  return (
    <svg className="signal-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="24 hour odor signal">
      <defs>
        <linearGradient id="signalFill" x1="0" x2="1">
          <stop offset="0%" stopColor="#3f88d8" />
          <stop offset="52%" stopColor="#4ebe92" />
          <stop offset="100%" stopColor="#f5533d" />
        </linearGradient>
      </defs>
      <line x1="12" x2={width - 12} y1={height - 22} y2={height - 22} stroke="#d8ddd8" />
      <path d={path.d} fill="none" stroke="url(#signalFill)" strokeLinecap="round" strokeWidth="5" />
      <line x1={path.xNow} x2={path.xNow} y1="10" y2={height - 18} stroke="#1c2d35" strokeDasharray="4 5" />
      <circle cx={path.xNow} cy={path.yNow} r="6" fill="#1c2d35" />
      {[0, 6, 12, 18, 24].map((tick) => (
        <text key={tick} x={tick === 24 ? width - 16 : tick * 14 + 12} y={height - 4}>
          {tick}
        </text>
      ))}
    </svg>
  );
}

function ControlPanel({
  settings,
  field,
  time,
  scentView,
  layerToggles,
  weatherGrid,
  weatherStatus,
  environmentCoverage,
  environmentStatus,
  environmentMessage,
  addingChamber,
  chamberTwins,
  selectedChamberId,
  onSettings,
  onStartAddChamber,
  onSelectChamber,
  onRemoveChamber,
  onScentView,
  onLayerToggle,
}: {
  settings: Settings;
  field: FieldResult | null;
  time: number;
  scentView: ScentView;
  layerToggles: LayerToggles;
  weatherGrid: WeatherGrid | null;
  weatherStatus: "idle" | "loading" | "ready" | "error";
  environmentCoverage: EnvironmentCoverage;
  environmentStatus: "idle" | "loading" | "ready" | "error";
  environmentMessage: string;
  addingChamber: boolean;
  chamberTwins: ChamberTwin[];
  selectedChamberId: string | null;
  onSettings: (patch: Partial<Settings>) => void;
  onStartAddChamber: () => void;
  onSelectChamber: (id: string) => void;
  onRemoveChamber: (id: string) => void;
  onScentView: (view: ScentView) => void;
  onLayerToggle: (key: keyof LayerToggles) => void;
}) {
  const [controlTab, setControlTab] = useState<ControlTab>("map");
  const chamberResultsById = new Map((field?.chambers ?? []).map((chamber) => [chamber.id, chamber]));
  const chamberList = settings.chambers ?? DEFAULTS.chambers;
  const chamberTwinsById = new Map(chamberTwins.map((twin) => [twin.chamber.id, twin]));

  return (
    <div className="controls">
      <section className="control-card panel-tabs-card">
        <div className="panel-tabs" role="tablist" aria-label="Model control sections">
          {[
            ["map", "Map"],
            ["chambers", "Chambers"],
            ["conditions", "Conditions"],
            ["output", "Output"],
          ].map(([tab, label]) => (
            <button key={tab} className={controlTab === tab ? "active" : ""} type="button" role="tab" aria-selected={controlTab === tab} onClick={() => setControlTab(tab as ControlTab)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {controlTab === "map" ? (
        <>
          <section className="control-card">
            <div className="section-title">
              <MapPin size={17} />
              9318 SW 43rd Ln
            </div>
            <div className="coordinate-grid">
              <label>
                Lat
                <input value={settings.lat} type="number" step="0.0001" onChange={(event) => onSettings({ lat: Number(event.target.value) })} />
              </label>
              <label>
                Lon
                <input value={settings.lon} type="number" step="0.0001" onChange={(event) => onSettings({ lon: Number(event.target.value) })} />
              </label>
            </div>
            <div className="choice-row">
              {[250, 500, 1000].map((radius) => (
                <button key={radius} className={settings.radius === radius ? "active" : ""} type="button" onClick={() => onSettings({ radius })}>
                  {radius === 1000 ? "1 km" : `${radius} m`}
                </button>
              ))}
            </div>
            <div className="choice-row">
              {(["street", "satellite"] as Basemap[]).map((basemap) => (
                <button key={basemap} className={settings.basemap === basemap ? "active" : ""} type="button" onClick={() => onSettings({ basemap })}>
                  {basemap}
                </button>
              ))}
            </div>
          </section>

          <section className="control-card">
            <div className="section-title">
              <Layers size={17} />
              Analysis layers
            </div>
            <div className="mode-grid">
              {(["combined", "ground", "air", "drainage", "surface", "rerelease", "water", "uncertainty"] as ScentView[]).map((view) => (
                <button key={view} className={scentView === view ? "active" : ""} type="button" onClick={() => onScentView(view)}>
                  {view === "rerelease" ? "re-release" : view}
                </button>
              ))}
            </div>
            <div className="toggle-grid">
              {(Object.keys(layerToggles) as (keyof LayerToggles)[]).map((key) => (
                <label key={key} className="toggle-row">
                  <input type="checkbox" checked={layerToggles[key]} onChange={() => onLayerToggle(key)} />
                  <span>{key === "dogPath" ? "dog path" : key === "radius" ? "analysis radius" : key}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="control-card">
            <div className="section-title">Building influence</div>
            <div className="mode-grid">
              {(["normal", "obstruction", "wake", "shade"] as BuildingMode[]).map((mode) => (
                <button key={mode} className={settings.buildingMode === mode ? "active" : ""} type="button" onClick={() => onSettings({ buildingMode: mode })}>
                  {mode}
                </button>
              ))}
            </div>
            <p className="microcopy">
              {settings.buildingMode === "obstruction"
                ? "Buildings strongly block ground scent inside footprints."
                : settings.buildingMode === "wake"
                  ? "Building edges create stronger turbulence and scent pockets."
                  : settings.buildingMode === "shade"
                    ? "Building shade favors lower, more persistent edge scent."
                    : "Balanced obstruction, wake, and edge retention."}
            </p>
          </section>

          <section className="control-card">
            <div className="section-title">
              <Layers size={17} />
              Environment coverage
            </div>
            <div className="environment-readout">
              <div>
                <span>Status</span>
                <strong>{environmentStatus === "loading" ? "refreshing" : environmentStatus === "error" ? "partial" : `${Math.round(environmentCoverage.score * 100)}%`}</strong>
              </div>
              <div>
                <span>Missing</span>
                <strong>{environmentCoverage.missingLayers.length ? environmentCoverage.missingLayers.length : 0}</strong>
              </div>
            </div>
            <p className="microcopy">{environmentMessage || environmentCoverage.message}</p>
          </section>
        </>
      ) : null}

      {controlTab === "chambers" ? (
        <>
          <section className="control-card">
            <div className="section-title">
              <Layers size={17} />
              Chamber stations
            </div>
            <button className={`add-chamber-button ${addingChamber ? "active" : ""}`} type="button" onClick={onStartAddChamber}>
              <Plus size={16} />
              {addingChamber ? "Place on map" : "Add chamber"}
            </button>
            <div className="station-list">
              {chamberList.map((chamber, index) => {
                const chamberResult = chamberResultsById.get(chamber.id) as ChamberResult | undefined;
                const coverageStatus = environmentCoverage.stationStatuses[chamber.id];
                const twin = chamberTwinsById.get(chamber.id);
                return (
                  <div className={`station-row ${selectedChamberId === chamber.id ? "active" : ""}`} key={chamber.id}>
                    <button className="station-select-button" type="button" onClick={() => onSelectChamber(chamber.id)}>
                      <strong>{chamber.name}</strong>
                      <span>
                        {chamber.road} · vent {Math.round(chamber.ventDirection ?? 0)}deg · leak {Math.round((chamber.leakRate ?? 0.6) * 100)}%
                      </span>
                      {twin ? (
                        <span>
                          output {Math.round(twin.state.scentOutput * 100)}% · power {Math.round(twin.state.battery * 100)}%
                        </span>
                      ) : null}
                      <span className={`coverage-pill ${stationCoverageClass(coverageStatus)}`}>{stationCoverageLabel(coverageStatus)}</span>
                    </button>
                    <div className="station-metrics">
                      <div>
                        <span>{stationLabel(index)}</span>
                        <strong>{Math.round((chamberResult?.coverage ?? chamber.scentStrength) * 100)}%</strong>
                      </div>
                      <button className="remove-chamber-button" type="button" onClick={() => onRemoveChamber(chamber.id)} aria-label={`Remove ${chamber.name}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <ChamberTwinPanel twins={chamberTwins} selectedId={selectedChamberId} />
        </>
      ) : null}

      {controlTab === "conditions" ? (
        <>
          <section className="control-card">
            <div className="section-title">
              <Gauge size={17} />
              Source and age model
            </div>
            <div className="choice-row">
              {(["moving-live", "stationary-live", "training-aid"] as SourceType[]).map((sourceType) => (
                <button key={sourceType} className={settings.sourceType === sourceType ? "active" : ""} type="button" onClick={() => onSettings({ sourceType })}>
                  {sourceType.replace("-", " ")}
                </button>
              ))}
            </div>
            <div className="choice-row">
              {(["animal", "decomposition", "submerged"] as SourceType[]).map((sourceType) => (
                <button key={sourceType} className={settings.sourceType === sourceType ? "active" : ""} type="button" onClick={() => onSettings({ sourceType, waterEnabled: sourceType === "submerged" ? true : settings.waterEnabled })}>
                  {sourceType}
                </button>
              ))}
            </div>
            <div className="control-grid compact-grid">
              <RangeControl label="Source age" value={settings.sourceAgeHours} min={0} max={72} step={0.5} suffix=" h" icon={<Gauge size={16} />} onChange={(sourceAgeHours) => onSettings({ sourceAgeHours, trackAge: sourceAgeHours })} />
              <RangeControl label="Trail age" value={settings.trailAgeHours} min={0} max={48} step={0.5} suffix=" h" icon={<MapPin size={16} />} onChange={(trailAgeHours) => onSettings({ trailAgeHours })} />
              <RangeControl label="Plume age" value={settings.plumeAgeHours} min={0.1} max={12} step={0.1} suffix=" h" icon={<Wind size={16} />} onChange={(plumeAgeHours) => onSettings({ plumeAgeHours })} />
              <RangeControl label="Air loss" value={settings.airborneLossRate} min={0.05} max={0.85} step={0.01} icon={<Wind size={16} />} onChange={(airborneLossRate) => onSettings({ airborneLossRate })} />
              <RangeControl label="Deposition" value={settings.surfaceDepositionRate} min={0.05} max={0.85} step={0.01} icon={<Layers size={16} />} onChange={(surfaceDepositionRate) => onSettings({ surfaceDepositionRate })} />
              <RangeControl label="Re-release" value={settings.rereleaseRate} min={0} max={0.75} step={0.01} icon={<ThermometerSun size={16} />} onChange={(rereleaseRate) => onSettings({ rereleaseRate })} />
              <RangeControl label="Chemical change" value={settings.chemicalChangeRate} min={0} max={0.75} step={0.01} icon={<Droplets size={16} />} onChange={(chemicalChangeRate) => onSettings({ chemicalChangeRate })} />
              <label className="select-control">
                <span>Decomposition stage</span>
                <select value={settings.decompositionStage} onChange={(event) => onSettings({ decompositionStage: event.target.value as DecompositionStage })}>
                  <option value="none">none</option>
                  <option value="fresh">fresh</option>
                  <option value="active">active</option>
                  <option value="advanced">advanced</option>
                </select>
              </label>
            </div>
          </section>

          <section className="control-card">
            <div className="section-title">
              <Wind size={17} />
              Weather field
            </div>
            <div className="choice-row">
              {(["live", "manual"] as WeatherSource[]).map((source) => (
                <button key={source} className={settings.weatherSource === source ? "active" : ""} type="button" onClick={() => onSettings({ weatherSource: source })}>
                  {source === "live" ? "Live grid" : "Manual"}
                </button>
              ))}
            </div>
            <p className="microcopy">
              {settings.weatherSource === "live"
                ? weatherStatus === "ready"
                  ? `${weatherGrid?.source ?? "Weather model"}: ${weatherGrid?.samples.length ?? 0} local samples over ${Math.round(weatherGrid?.sampleRadiusMeters ?? 0)} m, ${Math.round(weatherGrid?.historyHours ?? 0)} h history window.`
                  : weatherStatus === "loading"
                    ? "Fetching local wind, gust, temperature, humidity, and precipitation samples."
                    : "Live weather unavailable; the model falls back to manual sliders."
                : "Manual mode uses the sliders below as the weather field baseline."}
            </p>
            <div className="weather-readout">
              <div>
                <span>Temp</span>
                <strong>{Math.round(field?.weather.temperature ?? settings.temperature)}F</strong>
              </div>
              <div>
                <span>RH</span>
                <strong>{Math.round(field?.weather.humidity ?? settings.humidity)}%</strong>
              </div>
              <div>
                <span>Rain</span>
                <strong>{Math.round(((field?.weather.rain ?? settings.rain) || 0) * 100)}%</strong>
              </div>
              <div>
                <span>Gust</span>
                <strong>{(field?.weather.windGust ?? settings.windSpeed).toFixed(1)} m/s</strong>
              </div>
            </div>
          </section>

          <section className="control-card control-grid">
            <RangeControl label="Wind bearing" value={settings.windDir} min={0} max={359} step={1} suffix="deg" icon={<Wind size={16} />} onChange={(windDir) => onSettings({ windDir })} />
            <RangeControl label="Wind speed" value={settings.windSpeed} min={0.4} max={11} step={0.1} suffix=" m/s" icon={<Gauge size={16} />} onChange={(windSpeed) => onSettings({ windSpeed })} />
            <RangeControl label="Gustiness" value={settings.gustiness} min={0} max={1} step={0.01} icon={<Wind size={16} />} onChange={(gustiness) => onSettings({ gustiness })} />
            <RangeControl label="Temperature" value={settings.temperature} min={25} max={105} step={1} suffix="F" icon={<ThermometerSun size={16} />} onChange={(temperature) => onSettings({ temperature })} />
            <RangeControl label="Humidity" value={settings.humidity} min={5} max={100} step={1} suffix="%" icon={<Droplets size={16} />} onChange={(humidity) => onSettings({ humidity })} />
            <RangeControl label="Rain" value={settings.rain} min={0} max={1} step={0.01} icon={<CloudRain size={16} />} onChange={(rain) => onSettings({ rain })} />
            <RangeControl label="Sunlight" value={settings.sunlight} min={0} max={1} step={0.01} icon={<ThermometerSun size={16} />} onChange={(sunlight) => onSettings({ sunlight })} />
            <RangeControl label="Track age" value={settings.trackAge} min={0} max={36} step={0.5} suffix=" h" icon={<Gauge size={16} />} onChange={(trackAge) => onSettings({ trackAge })} />
            <RangeControl label="Contamination" value={settings.contamination} min={0} max={1} step={0.01} icon={<MapPin size={16} />} onChange={(contamination) => onSettings({ contamination })} />
            <RangeControl label="Stability" value={settings.stability} min={0} max={1} step={0.01} icon={<Layers size={16} />} onChange={(stability) => onSettings({ stability })} />
            <RangeControl label="Canopy" value={settings.canopy} min={0} max={1} step={0.01} icon={<Layers size={16} />} onChange={(canopy) => onSettings({ canopy })} />
            <RangeControl label="Roughness" value={settings.roughness} min={0} max={1} step={0.01} icon={<Layers size={16} />} onChange={(roughness) => onSettings({ roughness })} />
            <RangeControl label="Drainage" value={settings.drainage} min={0} max={1} step={0.01} icon={<CloudRain size={16} />} onChange={(drainage) => onSettings({ drainage })} />
            <RangeControl label="Source" value={settings.sourceStrength} min={0.1} max={1} step={0.01} icon={<Gauge size={16} />} onChange={(sourceStrength) => onSettings({ sourceStrength })} />
            <label className="select-control">
              <span>Surface</span>
              <select value={settings.surface} onChange={(event) => onSettings({ surface: event.target.value as Surface })}>
                <option value="mixed">mixed</option>
                <option value="grass">grass</option>
                <option value="forest">forest</option>
                <option value="soil">soil</option>
                <option value="pavement">pavement</option>
              </select>
            </label>
          </section>

          <section className="control-card">
            <div className="section-title">
              <CloudRain size={17} />
              Water pathway
            </div>
            <label className="toggle-row water-toggle">
              <input type="checkbox" checked={settings.waterEnabled} onChange={() => onSettings({ waterEnabled: !settings.waterEnabled })} />
              <span>Model underwater transport, surface emergence, and airborne detection zone</span>
            </label>
            <div className="control-grid compact-grid">
              <label className="select-control">
                <span>Water body</span>
                <select value={settings.waterBodyType} onChange={(event) => onSettings({ waterBodyType: event.target.value as WaterBodyType })}>
                  <option value="retention-basin">retention basin</option>
                  <option value="pond">pond</option>
                  <option value="lake">lake</option>
                  <option value="river">river</option>
                  <option value="canal">canal</option>
                  <option value="ocean">ocean</option>
                </select>
              </label>
              <RangeControl label="Source depth" value={settings.waterDepth} min={0.2} max={30} step={0.1} suffix=" m" icon={<Droplets size={16} />} onChange={(waterDepth) => onSettings({ waterDepth })} />
              <RangeControl label="Current bearing" value={settings.waterCurrentDir} min={0} max={359} step={1} suffix="deg" icon={<Wind size={16} />} onChange={(waterCurrentDir) => onSettings({ waterCurrentDir })} />
              <RangeControl label="Current speed" value={settings.waterCurrentSpeed} min={0} max={2.5} step={0.01} suffix=" m/s" icon={<Gauge size={16} />} onChange={(waterCurrentSpeed) => onSettings({ waterCurrentSpeed })} />
              <RangeControl label="Vertical mixing" value={settings.verticalMixing} min={0} max={1} step={0.01} icon={<Layers size={16} />} onChange={(verticalMixing) => onSettings({ verticalMixing })} />
              <RangeControl label="Wave action" value={settings.waveAction} min={0} max={1} step={0.01} icon={<CloudRain size={16} />} onChange={(waveAction) => onSettings({ waveAction })} />
              <RangeControl label="Water turbulence" value={settings.waterTurbulence} min={0} max={1} step={0.01} icon={<Wind size={16} />} onChange={(waterTurbulence) => onSettings({ waterTurbulence })} />
              <RangeControl label="Buoyancy" value={settings.sourceBuoyancy} min={0} max={1} step={0.01} icon={<ThermometerSun size={16} />} onChange={(sourceBuoyancy) => onSettings({ sourceBuoyancy })} />
              <RangeControl label="Salinity" value={settings.salinity} min={0} max={1} step={0.01} icon={<Droplets size={16} />} onChange={(salinity) => onSettings({ salinity })} />
            </div>
          </section>
        </>
      ) : null}

      {controlTab === "output" ? (
        <section className="control-card">
          <div className="section-title">Signal strength</div>
          <SignalChart signal={field?.signal ?? []} time={time} />
          <div className="metrics-grid">
            <Metric label="Detect" value={(field?.metrics.detectability ?? 0) * 100} />
            <Metric label="Area" value={(field?.metrics.coverage ?? 0) * 100} />
            <Metric label="Trail" value={(field?.metrics.continuity ?? 0) * 100} />
            <Metric label="Uncertain" value={(field?.metrics.uncertainty ?? 0) * 100} />
            <Metric label="Ground" value={(field?.metrics.groundHold ?? 0) * 100} />
            <Metric label="Airborne" value={(field?.metrics.airborne ?? 0) * 100} />
            <Metric label="Drainage" value={(field?.metrics.drainageLoad ?? 0) * 100} />
            <Metric label="Deposited" value={(field?.metrics.surfaceLoad ?? 0) * 100} />
            <Metric label="Re-release" value={(field?.metrics.reReleaseLoad ?? 0) * 100} />
            <Metric label="Water" value={(field?.metrics.waterSignal ?? 0) * 100} />
            <Metric label="Pockets" value={field?.metrics.pockets ?? 0} suffix="" />
          </div>
          <p className="explanation">{field?.explanation}</p>
          <div className="assumption-list">
            {(field?.assumptions ?? []).map((assumption) => (
              <span key={assumption}>{assumption}</span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function simulationClockLabel(hour: number) {
  return `Hour ${hour.toFixed(1)} / 24`;
}

function PlaybackBar({
  time,
  playing,
  speed,
  onReset,
  onTime,
  onPlay,
  onSpeed,
}: {
  time: number;
  playing: boolean;
  speed: number;
  onReset: () => void;
  onTime: (value: number) => void;
  onPlay: () => void;
  onSpeed: (value: number) => void;
}) {
  return (
    <div className="map-playback" aria-label="24-hour simulation playback">
      <div className="playback-main">
        <button className="icon-button primary" type="button" onClick={onPlay} aria-label={playing ? "Pause 24-hour simulation" : "Play 24-hour simulation"}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="playback-clock">
          <span>24-hour simulation clock</span>
          <strong>{hourLabel(time)}</strong>
          <em>{simulationClockLabel(time)}</em>
        </div>
        <div className="playback-track">
          <input className="time-slider" aria-label="Simulation hour in 24-hour model" type="range" min="0" max="24" step="0.05" value={time} onChange={(event) => onTime(Number(event.target.value))} />
          <div className="playback-ticks" aria-hidden="true">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onReset} aria-label="Reset simulation">
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="speed-row" aria-label="Playback speed">
        <span>Speed</span>
        {[0.5, 1, 2, 4].map((candidate) => (
          <button key={candidate} className={speed === candidate ? "active" : ""} type="button" onClick={() => onSpeed(candidate)}>
            {candidate}x
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const sheetDrag = useRef<{ y: number; open: boolean } | null>(null);
  const workerRequestId = useRef(0);
  const workerBusy = useRef(false);
  const staticEnvironmentRef = useRef<EnvironmentData | null>(null);
  const environmentRequestKey = useRef<string>("");
  const pendingWorkerPayload = useRef<{
    settings: Settings & { weatherGrid: WeatherGrid | null };
    time: number;
    requestId: number;
    quick: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [field, setField] = useState<FieldResult | null>(null);
  const [time, setTime] = useState(18);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentData | null>(null);
  const [environmentStatus, setEnvironmentStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [environmentMessage, setEnvironmentMessage] = useState("");
  const [weatherGrid, setWeatherGrid] = useState<WeatherGrid | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mapReady, setMapReady] = useState(false);
  const [scentView, setScentView] = useState<ScentView>("combined");
  const [addingChamber, setAddingChamber] = useState(false);
  const [selectedChamberId, setSelectedChamberId] = useState<string | null>(DEFAULTS.chambers[0]?.id ?? null);
  const [layerToggles, setLayerToggles] = useState<LayerToggles>({
    odor: true,
    uncertainty: true,
    radius: false,
    buildings: true,
    roads: true,
    stormwater: true,
    canopy: true,
    chambers: true,
    water: true,
    wind: true,
    dogPath: true,
  });
  const activeChambers = settings.chambers ?? DEFAULTS.chambers;
  const environmentCoverage = useMemo(() => evaluateEnvironmentCoverage(environment, settings, activeChambers), [activeChambers, environment, settings]);
  const chamberTwins = useMemo(() => {
    const coverageById = new Map((field?.chambers ?? []).map((chamber) => [chamber.id, chamber.coverage]));
    return buildChamberTwins({
      chambers: activeChambers,
      time,
      coverageById,
      coverageStatusById: environmentCoverage.stationStatuses,
      weather: {
        temperature: field?.weather.temperature ?? settings.temperature,
        humidity: field?.weather.humidity ?? settings.humidity,
        rain: field?.weather.rain ?? settings.rain,
        windSpeed: field?.weather.windSpeed ?? settings.windSpeed,
        windDir: field?.weather.windDir ?? settings.windDir,
      },
    });
  }, [
    activeChambers,
    environmentCoverage.stationStatuses,
    field?.chambers,
    field?.weather,
    settings.humidity,
    settings.rain,
    settings.temperature,
    settings.windDir,
    settings.windSpeed,
    time,
  ]);
  const simulationTime = useMemo(() => Math.round(time * 10) / 10, [time]);
  const modelSettings = useMemo(
    () => ({
      ...settings,
      chambers: activeChambers,
      weatherGrid: settings.weatherSource === "live" ? weatherGrid : null,
    }),
    [activeChambers, settings, weatherGrid],
  );

  const onSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const addChamberAt = useCallback((lon: number, lat: number) => {
    const chamber = createPlacedChamber({ index: activeChambers.length, lat, lon, windDir: settings.windDir, trackAge: settings.trackAge });
    setSettings((current) => {
      const chambers = current.chambers ?? DEFAULTS.chambers;
      return { ...current, chambers: [...chambers, chamber] };
    });
    setSelectedChamberId(chamber.id);
    setLayerToggles((current) => ({ ...current, chambers: true }));
    setAddingChamber(false);
  }, [activeChambers.length, settings.trackAge, settings.windDir]);

  const removeChamber = useCallback((id: string) => {
    if (selectedChamberId === id) {
      setSelectedChamberId(activeChambers.find((chamber) => chamber.id !== id)?.id ?? null);
    }
    setSettings((current) => {
      const chambers = current.chambers ?? DEFAULTS.chambers;
      return { ...current, chambers: chambers.filter((chamber) => chamber.id !== id) };
    });
  }, [activeChambers, selectedChamberId]);

  const reset = useCallback(() => {
    setSettings(DEFAULTS);
    setTime(18);
    setSpeed(1);
    setPlaying(true);
    setWeatherGrid(null);
    setWeatherStatus("idle");
    setScentView("combined");
    setAddingChamber(false);
    setSelectedChamberId(DEFAULTS.chambers[0]?.id ?? null);
    setLayerToggles({
      odor: true,
      uncertainty: true,
      radius: false,
      buildings: true,
      roads: true,
      stormwater: true,
      canopy: true,
      chambers: true,
      water: true,
      wind: true,
      dogPath: true,
    });
  }, []);

  const toggleLayer = useCallback((key: keyof LayerToggles) => {
    setLayerToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  useEffect(() => {
    if (!playing) return;
    const interval = window.setInterval(() => {
      setTime((current) => (current + 0.035 * speed) % 24);
    }, 120);
    return () => window.clearInterval(interval);
  }, [playing, speed]);

  useEffect(() => {
    if (settings.weatherSource !== "live") {
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setWeatherStatus("loading");
    });
    fetchWeatherGrid(settings, controller.signal)
      .then((grid) => {
        setWeatherGrid(grid);
        setWeatherStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn(error);
        setWeatherStatus("error");
      });
    return () => controller.abort();
  }, [settings]);

  useEffect(() => {
    const worker = new Worker(`/odor-worker.js?v=${WORKER_VERSION}`);
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<FieldResult & { requestId?: number }>) => {
      workerBusy.current = false;
      if (!event.data.requestId || event.data.requestId === workerRequestId.current) {
        setField(event.data);
      }
      const pending = pendingWorkerPayload.current;
      if (pending) {
        pendingWorkerPayload.current = null;
        workerBusy.current = true;
        worker.postMessage(pending);
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/gainesville-environment.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: EnvironmentData | null) => {
        if (cancelled || !data) return;
        const withBounds = { ...data, bounds: environmentFeatureBounds(data) ?? undefined, coverageSource: "static" };
        staticEnvironmentRef.current = withBounds;
        setEnvironment(withBounds);
        setEnvironmentStatus("ready");
        setEnvironmentMessage("Static Gainesville environment loaded.");
        workerRef.current?.postMessage({ environment: withBounds });
      })
      .catch(() => {
        if (!cancelled) {
          setEnvironment(null);
          setEnvironmentStatus("error");
          setEnvironmentMessage("Environment data failed to load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!environment) return;
    workerRef.current?.postMessage({ environment });
  }, [environment]);

  useEffect(() => {
    const baseEnvironment = staticEnvironmentRef.current;
    if (!baseEnvironment || !environmentCoverage.needsRefresh) return;
    const requestKey = boundsKey(environmentCoverage.requiredBounds);
    if (environmentRequestKey.current === requestKey) return;
    environmentRequestKey.current = requestKey;
    const controller = new AbortController();
    setEnvironmentStatus("loading");
    setEnvironmentMessage("Refreshing county buildings and stormwater for the expanded station layout.");
    fetchExpandedEnvironment(baseEnvironment, environmentCoverage.requiredBounds, controller.signal)
      .then((nextEnvironment) => {
        setEnvironment(nextEnvironment);
        setEnvironmentStatus("ready");
        const buildingCount = nextEnvironment.buildings.features.length;
        const stormwaterCount = Object.values(nextEnvironment.stormwater?.counts ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
        const refreshedCoverage = evaluateEnvironmentCoverage(nextEnvironment, settings, activeChambers);
        const sparseNote = refreshedCoverage.missingLayers.length ? ` Static fallback remains for ${refreshedCoverage.missingLayers.join(", ")}.` : "";
        setEnvironmentMessage(`Expanded environment loaded: ${buildingCount} buildings and ${stormwaterCount} stormwater features available for this station layout.${sparseNote}`);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn(error);
        setEnvironmentStatus("error");
        setEnvironmentMessage("Expanded environment refresh failed; using the best available static/local layer coverage.");
      });
    return () => controller.abort();
  }, [
    environmentCoverage.needsRefresh,
    environmentCoverage.requiredBounds,
    settings,
    activeChambers,
  ]);

  useEffect(() => {
    const requestId = workerRequestId.current + 1;
    workerRequestId.current = requestId;
    const payload = { settings: modelSettings, time: simulationTime, requestId, quick: playing };
    const worker = workerRef.current;
    if (!worker) return;
    if (workerBusy.current) {
      pendingWorkerPayload.current = payload;
      return;
    }
    workerBusy.current = true;
    worker.postMessage(payload);
  }, [modelSettings, playing, simulationTime]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current || !MAPTILER_KEY) return;

    const map = new maplibregl.Map({
      container: mapNode.current,
      style: styleUrl(DEFAULTS.basemap),
      center: [DEFAULTS.lon, DEFAULTS.lat],
      zoom: DEFAULTS.radius >= 1000 ? 14.2 : DEFAULTS.radius <= 250 ? 16.2 : 15.2,
      pitch: 54,
      bearing: -18,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    mapRef.current = map;
    overlayRef.current = overlay;
    map.once("load", () => setMapReady(true));

    return () => {
      setMapReady(false);
      overlay.finalize();
      map.remove();
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !MAPTILER_KEY) return;
    setMapReady(false);
    const handleIdle = () => setMapReady(true);
    map.once("idle", handleIdle);
    map.setStyle(styleUrl(settings.basemap));
    return () => {
      map.off("idle", handleIdle);
    };
  }, [settings.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = addingChamber ? "crosshair" : "";
    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (!addingChamber) return;
      addChamberAt(event.lngLat.lng, event.lngLat.lat);
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      if (map.getCanvas()) map.getCanvas().style.cursor = "";
    };
  }, [addChamberAt, addingChamber]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.easeTo({
      center: [settings.lon, settings.lat],
      zoom: settings.radius >= 1000 ? 14.2 : settings.radius <= 250 ? 16.2 : 15.2,
      duration: 700,
    });
  }, [settings.lat, settings.lon, settings.radius]);

  const radiusFeature = useMemo(
    () =>
      circle([settings.lon, settings.lat], settings.radius / 1000, {
        steps: 128,
        units: "kilometers",
      }),
    [settings.lat, settings.lon, settings.radius],
  );

  const chamberCoverage = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: activeChambers.map((chamber) =>
        circle([chamber.lon, chamber.lat], chamber.detectionRadius / 1000, {
          steps: 48,
          units: "kilometers",
          properties: {
            id: chamber.id,
            title: `${chamber.name} PIR/camera footprint`,
            detail: `${chamber.detectionRadius} m detection radius around the scent chamber on ${chamber.road}.`,
          },
        }),
      ),
    }),
    [activeChambers],
  );

  const stormwaterLines = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...(environment?.stormwater?.gravityMains.features ?? []),
        ...(environment?.stormwater?.openChannels.features ?? []),
        ...(environment?.stormwater?.virtualMains.features ?? []),
      ],
    }),
    [environment],
  );

  const stormwaterPoints = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...(environment?.stormwater?.dropInlets.features ?? []),
        ...(environment?.stormwater?.manholes.features ?? []),
        ...(environment?.stormwater?.endStructures.features ?? []),
        ...(environment?.stormwater?.networkStructures.features ?? []),
        ...(environment?.stormwater?.cleanOuts.features ?? []),
        ...(environment?.stormwater?.stormBasins.features ?? []),
        ...(environment?.stormwater?.pumps.features ?? []),
      ],
    }),
    [environment],
  );

  const stormwaterPolygons = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...(environment?.stormwater?.stormPonds.features ?? []),
        ...(environment?.stormwater?.stormStructures.features ?? []),
      ],
    }),
    [environment],
  );

  const chamberIds = useMemo(() => new Set(activeChambers.map((chamber) => chamber.id)), [activeChambers]);

  const indicators = useMemo<MapIndicator[]>(() => {
    const chamberResultsById = new Map((field?.chambers ?? []).map((chamber) => [chamber.id, chamber]));
    const chamberTwinsById = new Map(chamberTwins.map((twin) => [twin.chamber.id, twin]));
    const chamberData = activeChambers.map((chamber) => ({ ...chamber, coverage: chamberResultsById.get(chamber.id)?.coverage }));
    const chamberIndicators = chamberData.map((chamber, index) => {
      const twin = chamberTwinsById.get(chamber.id);
      const statusPrefix = twin ? `Twin ${twin.state.status}; output ${Math.round(twin.state.scentOutput * 100)}%, battery ${Math.round(twin.state.battery * 100)}%, contamination ${Math.round(twin.state.contaminationRisk * 100)}%. ` : "";
      return {
        id: chamber.id,
        label: stationLabel(index),
        title: `${chamber.name} - ${chamber.road}`,
        detail: `${statusPrefix}Scent chamber beacon. Scent ${Math.round(chamber.scentStrength * 100)}%, food ${Math.round(chamber.foodStrength * 100)}%, vent ${Math.round(chamber.ventDirection ?? 0)} deg, leak ${Math.round((chamber.leakRate ?? 0.6) * 100)}%, item age ${Math.round(chamber.itemAge ?? 0)} h, recharge ${Math.round(chamber.rechargeHours ?? 24)} h, PIR radius ${chamber.detectionRadius} m, modeled coverage ${Math.round(((chamber as ChamberResult).coverage ?? 0) * 100)}%.`,
        lon: chamber.lon,
        lat: chamber.lat,
        radius: 15 + chamber.scentStrength * 12,
        elevation: 38 + chamber.scentStrength * 42,
        color:
          twin?.state.status === "watch"
            ? ([242, 184, 75, 235] as [number, number, number, number])
            : twin?.state.status === "low-output" || twin?.state.status === "offline"
              ? ([126, 95, 86, 235] as [number, number, number, number])
              : ([47, 125, 119, 235] as [number, number, number, number]),
      };
    });

    return [
      {
        id: "source",
        label: "LKP",
        title: "Source / last known point",
        detail: `9318 SW 43rd Ln. Subject odor source centered here with ${settings.radius} m local modeling radius.`,
        lon: settings.lon,
        lat: settings.lat,
        radius: 20,
        elevation: 66,
        color: [245, 83, 61, 245] as [number, number, number, number],
      },
      ...chamberIndicators,
    ];
  }, [activeChambers, chamberTwins, field?.chambers, settings.lat, settings.lon, settings.radius]);

  useEffect(() => {
    if (!overlayRef.current || !field || !mapReady) return;
    const cellRadius = clamp(settings.radius / 42, 5, 24);
    overlayRef.current.setProps({
      getTooltip: ({ object }: { object?: Partial<Cell & MapIndicator & WaterScentZone> & { properties?: { title?: string; detail?: string } } }) => {
        if (!object) return null;
        if (object.properties?.title) {
          return {
            html: tooltipHtml(object.properties.title, object.properties.detail ?? ""),
            style: { backgroundColor: "rgba(23, 37, 45, 0.94)", borderRadius: "8px", color: "#fff", padding: "10px 12px" },
          };
        }
        if ("title" in object && object.title) {
          return {
            html: tooltipHtml(object.title, object.detail ?? ""),
            style: { backgroundColor: "rgba(23, 37, 45, 0.94)", borderRadius: "8px", color: "#fff", padding: "10px 12px" },
          };
        }
        if ("stage" in object && object.stage) {
          return {
            html: tooltipHtml(
              `${object.stage} water scent zone`,
              `Signal ${Math.round((object.intensity ?? 0) * 100)}%, uncertainty ${Math.round((object.uncertainty ?? 0) * 100)}%. A canine alert may be displaced from the underwater source by both water movement and wind.`,
            ),
            style: { backgroundColor: "rgba(23, 37, 45, 0.94)", borderRadius: "8px", color: "#fff", padding: "10px 12px" },
          };
        }
        if ("intensity" in object && object.intensity !== undefined) {
          return {
            html: tooltipHtml(
              `${object.layer ?? "odor"} scent cell`,
              `Intensity ${Math.round(object.intensity * 100)}%, ground ${Math.round((object.ground ?? 0) * 100)}%, air ${Math.round((object.air ?? 0) * 100)}%, drainage ${Math.round((object.drainage ?? 0) * 100)}%, deposited ${Math.round((object.surfaceDeposit ?? 0) * 100)}%, re-release ${Math.round((object.reRelease ?? 0) * 100)}%, water ${Math.round((object.waterSignal ?? 0) * 100)}%, uncertainty ${Math.round((object.uncertainty ?? 0) * 100)}%.${object.outsideRadius ? " Outside the selected analysis radius; shown as solver spillover." : ""}`,
            ),
            style: { backgroundColor: "rgba(23, 37, 45, 0.94)", borderRadius: "8px", color: "#fff", padding: "10px 12px" },
          };
        }
        return null;
      },
      layers: [
        new GeoJsonLayer({
          id: "radius-outline",
          data: layerToggles.radius ? radiusFeature : { type: "FeatureCollection", features: [] },
          filled: false,
          stroked: true,
          getLineColor: [28, 45, 53, 78],
          getLineWidth: 1,
          lineWidthMinPixels: 1,
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-canopy",
          data: layerToggles.canopy ? environment?.canopy ?? { type: "FeatureCollection", features: [] } : { type: "FeatureCollection", features: [] },
          filled: true,
          stroked: true,
          getFillColor: [42, 126, 81, 64],
          getLineColor: [31, 121, 86, 150],
          getLineWidth: 3,
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-buildings",
          data: layerToggles.buildings ? environment?.buildings ?? { type: "FeatureCollection", features: [] } : { type: "FeatureCollection", features: [] },
          filled: true,
          stroked: true,
          extruded: true,
          wireframe: false,
          getElevation: (feature) => feature.properties?.heightMeters ?? 5,
          getFillColor: [72, 78, 82, 205],
          getLineColor: [30, 36, 40, 230],
          getLineWidth: 1,
          lineWidthMinPixels: 1,
          pickable: true,
          material: {
            ambient: 0.42,
            diffuse: 0.58,
            shininess: 24,
            specularColor: [230, 230, 220],
          },
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-roads",
          data: layerToggles.roads ? environment?.roads ?? { type: "FeatureCollection", features: [] } : { type: "FeatureCollection", features: [] },
          filled: false,
          stroked: true,
          getLineColor: (feature) => {
            const highway = feature.properties?.highway;
            if (highway === "tertiary") return [95, 82, 61, 210];
            if (highway === "service") return [125, 113, 93, 150];
            return [80, 91, 96, 175];
          },
          getLineWidth: (feature) => (feature.properties?.highway === "tertiary" ? 16 : feature.properties?.highway === "service" ? 7 : 11),
          lineWidthMinPixels: 2,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-stormwater-polygons",
          data: layerToggles.stormwater ? stormwaterPolygons : { type: "FeatureCollection", features: [] },
          filled: true,
          stroked: true,
          getFillColor: [43, 126, 170, 48],
          getLineColor: [43, 126, 170, 172],
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-stormwater-lines",
          data: layerToggles.stormwater ? stormwaterLines : { type: "FeatureCollection", features: [] },
          filled: false,
          stroked: true,
          getLineColor: (feature) => {
            if (feature.properties?.kind === "channel") return [28, 111, 156, 220];
            if (feature.properties?.kind === "virtual-pipe") return [96, 143, 166, 138];
            return [37, 104, 150, 178];
          },
          getLineWidth: (feature) => (feature.properties?.kind === "channel" ? 8 : feature.properties?.kind === "virtual-pipe" ? 3 : 5),
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer<GeoJsonFeature>({
          id: "mapped-trees",
          data: layerToggles.canopy ? environment?.trees.features ?? [] : [],
          getPosition: (feature) => feature.geometry.type === "Point" ? feature.geometry.coordinates : [0, 0],
          getRadius: 7,
          radiusUnits: "meters",
          getFillColor: [31, 121, 86, 180],
          stroked: true,
          getLineColor: [255, 255, 255, 150],
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer<GeoJsonFeature>({
          id: "mapped-stormwater-points",
          data: layerToggles.stormwater ? stormwaterPoints.features : [],
          getPosition: (feature) => feature.geometry.type === "Point" ? feature.geometry.coordinates : [0, 0],
          getRadius: (feature) => {
            if (feature.properties?.kind === "inlet") return 7;
            if (feature.properties?.kind === "outfall") return 9;
            if (feature.properties?.kind === "basin") return 10;
            return 5;
          },
          radiusUnits: "meters",
          getFillColor: (feature) => {
            if (feature.properties?.kind === "inlet") return [43, 126, 170, 205];
            if (feature.properties?.kind === "outfall") return [30, 92, 137, 220];
            if (feature.properties?.kind === "basin") return [73, 151, 184, 150];
            return [87, 151, 180, 140];
          },
          stroked: true,
          getLineColor: [255, 255, 255, 170],
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer<Cell>({
          id: "odor-field",
          data: layerToggles.odor ? field.cells.filter((cell) => scentValue(cell, scentView) > scentThreshold(scentView, settings.radius)) : [],
          getPosition: (cell) => [cell.lon, cell.lat],
          getRadius: (cell) => cellRadius * (cell.outsideRadius ? 0.68 : 1) * (0.5 + scentValue(cell, scentView) + (layerToggles.uncertainty ? cell.uncertainty * 0.2 : 0)),
          radiusUnits: "meters",
          getFillColor: (cell) => scentColor(cell, scentView),
          pickable: true,
          stroked: false,
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer<WaterScentZone>({
          id: "water-scent-zones",
          data: layerToggles.water && (settings.waterEnabled || settings.sourceType === "submerged") ? field.waterZones : [],
          getPosition: (zone) => [zone.lon, zone.lat],
          getRadius: (zone) => (zone.stage === "underwater" ? 14 : zone.stage === "surface" ? 20 : 24) * (0.6 + zone.intensity),
          radiusUnits: "meters",
          getFillColor: (zone) =>
            zone.stage === "underwater"
              ? [21, 77, 135, 150]
              : zone.stage === "surface"
                ? [43, 126, 170, 178]
                : [63, 136, 216, 126],
          stroked: true,
          getLineColor: (zone) => (zone.stage === "surface" ? [255, 255, 255, 190] : [20, 48, 76, 175]),
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new GeoJsonLayer<GeoJsonFeature>({
          id: "mapped-building-outlines",
          data: layerToggles.buildings ? environment?.buildings ?? { type: "FeatureCollection", features: [] } : { type: "FeatureCollection", features: [] },
          filled: false,
          stroked: true,
          getLineColor: [21, 28, 32, 235],
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          pickable: true,
          parameters: { depthTest: false },
        }),
        new LineLayer<Vector>({
          id: "wind-vectors",
          data: layerToggles.wind ? field.vectors : [],
          getSourcePosition: (vector) => vector.from,
          getTargetPosition: (vector) => vector.to,
          getColor: (vector) => [34, 63, 84, 90 + Math.round(vector.strength * 80)],
          getWidth: 2,
          widthMinPixels: 1,
          widthMaxPixels: 3,
        }),
        new PathLayer<{ path: [number, number][] }>({
          id: "dog-path",
          data: layerToggles.dogPath ? [{ path: field.dogPath }] : [],
          getPath: (pathData) => pathData.path,
          getColor: [25, 36, 43, 230],
          getWidth: 5,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
        }),
        new ColumnLayer<MapIndicator>({
          id: "3d-indicators",
          data: indicators.filter((indicator) => (layerToggles.chambers || !chamberIds.has(indicator.id)) && (layerToggles.stormwater || !indicator.id.startsWith("obstacle-"))),
          diskResolution: 24,
          radius: 16,
          radiusUnits: "meters",
          getPosition: (item) => [item.lon, item.lat],
          getElevation: (item) => item.elevation,
          getFillColor: (item) => item.color,
          getLineColor: [255, 255, 255, 210],
          lineWidthMinPixels: 1,
          stroked: true,
          extruded: true,
          pickable: true,
          material: {
            ambient: 0.45,
            diffuse: 0.55,
            shininess: 42,
            specularColor: [255, 255, 255],
          },
        }),
        new GeoJsonLayer({
          id: "chamber-coverage",
          data: layerToggles.chambers ? chamberCoverage : { type: "FeatureCollection", features: [] },
          filled: true,
          stroked: true,
          getFillColor: [47, 125, 119, 22],
          getLineColor: [47, 125, 119, 150],
          getLineWidth: 2,
          lineWidthMinPixels: 1,
          pickable: true,
        }),
        new ScatterplotLayer<ScentChamber>({
          id: "scent-chambers",
          data: layerToggles.chambers ? activeChambers : [],
          getPosition: (chamber) => [chamber.lon, chamber.lat],
          getRadius: (chamber) => 16 + chamber.scentStrength * 16,
          radiusUnits: "meters",
          getFillColor: [47, 125, 119, 235],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
        }),
        new TextLayer<MapIndicator>({
          id: "indicator-labels",
          data: indicators.filter((indicator) => (layerToggles.chambers || !chamberIds.has(indicator.id)) && (layerToggles.stormwater || !indicator.id.startsWith("obstacle-"))),
          getPosition: (item) => [item.lon, item.lat],
          getText: (item) => item.label,
          getSize: (item) => (item.label.length > 3 ? 11 : 14),
          getColor: [255, 255, 255, 255],
          getBackgroundColor: [23, 37, 45, 224],
          background: true,
          backgroundPadding: [5, 4],
          getPixelOffset: [0, -24],
          fontWeight: 800,
          billboard: true,
          pickable: true,
        }),
        new ScatterplotLayer<{ lon: number; lat: number }>({
          id: "source-point",
          data: [{ lon: settings.lon, lat: settings.lat }],
          getPosition: (point) => [point.lon, point.lat],
          getRadius: 18,
          radiusUnits: "meters",
          getFillColor: [245, 83, 61, 245],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
        }),
      ],
    });
  }, [activeChambers, chamberCoverage, chamberIds, environment, field, indicators, layerToggles, mapReady, radiusFeature, scentView, settings.lat, settings.lon, settings.radius, settings.sourceType, settings.waterEnabled, stormwaterLines, stormwaterPoints, stormwaterPolygons]);

  const sheetStyle = { transform: sheetOpen ? "translateY(0)" : "translateY(calc(100% - 156px))" };

  return (
    <main className="app-shell">
      <section className="map-stage">
        <div ref={mapNode} className="map-canvas" />
        {!MAPTILER_KEY && (
          <div className="map-warning">
            Add <code>NEXT_PUBLIC_MAPTILER_KEY</code> to load the basemap.
          </div>
        )}
        {addingChamber && <div className="map-placement-banner">Click map to place chamber</div>}
        <div className="map-status">
          <div>
            <span>Model clock</span>
            <strong>{hourLabel(time)}</strong>
          </div>
          <div>
            <span>{field?.weather.source === "live-grid" ? "Wind grid" : "Wind"}</span>
            <strong>
              {Math.round(field?.weather.windDir ?? settings.windDir)}deg / {(field?.weather.windSpeed ?? settings.windSpeed).toFixed(1)} m/s
            </strong>
          </div>
          <div>
            <span>Uncertainty</span>
            <strong>{Math.round((field?.metrics.uncertainty ?? 0) * 100)}%</strong>
          </div>
          <div>
            <span>Temp/RH</span>
            <strong>
              {Math.round(field?.weather.temperature ?? settings.temperature)}F / {Math.round(field?.weather.humidity ?? settings.humidity)}%
            </strong>
          </div>
        </div>
        <PlaybackBar time={time} playing={playing} speed={speed} onReset={reset} onTime={setTime} onPlay={() => setPlaying((current) => !current)} onSpeed={setSpeed} />
      </section>

      <aside className="desktop-panel">
        <ControlPanel
          settings={settings}
          field={field}
          time={time}
          scentView={scentView}
          layerToggles={layerToggles}
          weatherGrid={weatherGrid}
          weatherStatus={weatherStatus}
          environmentCoverage={environmentCoverage}
          environmentStatus={environmentStatus}
          environmentMessage={environmentMessage}
          addingChamber={addingChamber}
          chamberTwins={chamberTwins}
          selectedChamberId={selectedChamberId}
          onSettings={onSettings}
          onStartAddChamber={() => setAddingChamber((current) => !current)}
          onSelectChamber={setSelectedChamberId}
          onRemoveChamber={removeChamber}
          onScentView={setScentView}
          onLayerToggle={toggleLayer}
        />
      </aside>

      <aside className="mobile-sheet" style={sheetStyle}>
        <button
          className="sheet-handle"
          type="button"
          aria-label="Controls"
          onClick={() => setSheetOpen((current) => !current)}
          onPointerDown={(event) => {
            sheetDrag.current = { y: event.clientY, open: sheetOpen };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const start = sheetDrag.current;
            if (start) {
              const moved = event.clientY - start.y;
              if (moved < -20) setSheetOpen(true);
              if (moved > 20) setSheetOpen(false);
            }
            sheetDrag.current = null;
          }}
        >
          <span />
        </button>
        <ControlPanel
          settings={settings}
          field={field}
          time={time}
          scentView={scentView}
          layerToggles={layerToggles}
          weatherGrid={weatherGrid}
          weatherStatus={weatherStatus}
          environmentCoverage={environmentCoverage}
          environmentStatus={environmentStatus}
          environmentMessage={environmentMessage}
          addingChamber={addingChamber}
          chamberTwins={chamberTwins}
          selectedChamberId={selectedChamberId}
          onSettings={onSettings}
          onStartAddChamber={() => setAddingChamber((current) => !current)}
          onSelectChamber={setSelectedChamberId}
          onRemoveChamber={removeChamber}
          onScentView={setScentView}
          onLayerToggle={toggleLayer}
        />
      </aside>
    </main>
  );
}
