# Scent Simulation

Interactive geographic odor-field simulation for the area around `9318 SW 43rd Ln` in Gainesville, Florida. The app combines a MapLibre basemap, deck.gl visualization layers, local environment data, live weather sampling, and a browser worker that models scent transport across ground, air, and drainage channels.

This is an exploratory decision-support model, not a forensic instrument or surveyed ground truth. The coefficients are illustrative and should be treated as a way to compare scenarios, station placement, and environmental sensitivity.

## What The App Does

- Renders a 3D local map with buildings, roads, canopy, stormwater assets, odor intensity cells, wind vectors, a modeled dog path, and scent chamber stations.
- Simulates a 24-hour odor field with a controllable clock, playback speed, weather settings, building modes, surface assumptions, and analysis radius.
- Supports live weather mode using a 3x3 Open-Meteo sample grid around the site, with manual weather controls as fallback.
- Loads static Gainesville environment data from `public/gainesville-environment.json`.
- Dynamically refreshes Alachua County building footprints and City of Gainesville stormwater layers when stations extend beyond the static environment envelope.
- Models each scent chamber as a device twin with output, food attractant, battery, internal climate, contamination risk, service load, event logs, and recommendations.

## Tech Stack

- Next.js `16` app router, running through `vinext` for Cloudflare Worker compatibility.
- React `19` client UI.
- MapLibre GL for the basemap.
- deck.gl for map overlays, 3D columns, GeoJSON layers, vectors, paths, and text labels.
- Turf for radius and chamber-footprint geometry.
- D3 for the 24-hour signal chart.
- A dedicated browser Web Worker at `public/odor-worker.js` for the simulation workload.
- Optional Cloudflare D1/Drizzle plumbing is present but currently unused by the simulation.

## Requirements

- Node.js `>=22.13.0`
- A MapTiler API key for the basemap:

```bash
NEXT_PUBLIC_MAPTILER_KEY=your_key_here
```

The app still renders its controls without the key, but the basemap will show an in-app warning.

## Commands

```bash
npm install
npm run dev
npm run build
npm test
npm run lint
```

- `npm run dev` starts local vinext development.
- `npm run build` creates the production vinext build.
- `npm test` runs the build and then verifies the rendered HTML, source markers, worker model markers, and bundled environment data.
- `npm run lint` runs ESLint while ignoring build output folders.
- `npm run db:generate` is available for future Drizzle schema work.

## Project Structure

```text
app/
  layout.tsx             Next metadata, fonts, viewport
  page.tsx               Main client app, map state, controls, data fetches, deck.gl layers
  globals.css            Application layout and UI styling
  chatgpt-auth.ts        Optional Sign in with ChatGPT helpers

components/
  chamber-twin-panel.tsx Device-twin UI for selected scent chamber

lib/chamber-twin/
  types.ts               Chamber, weather, log, state, and twin types
  defaults.ts            Station labels and default custom-chamber creation
  simulator.ts           Chamber twin calculations, logs, badges, recommendations

public/
  odor-worker.js         Browser worker that builds odor fields and metrics
  gainesville-environment.json
                         Static local roads, buildings, canopy, and stormwater data

worker/
  index.ts               Cloudflare Worker entry point for vinext and image optimization

db/
  index.ts               Optional D1 getter
  schema.ts              Empty Drizzle schema placeholder

tests/
  rendered-html.test.mjs Server-render and source/data smoke tests

examples/d1/             Optional D1 example routes/schema
build/                   Local Sites/vite helper plugin
```

## Runtime Data Flow

1. `app/page.tsx` initializes the default site settings, stations, map layers, playback clock, and control panel.
2. The app fetches `/gainesville-environment.json`, computes its bounds, stores it as static environment data, and sends it to `public/odor-worker.js`.
3. If the selected radius or chamber layout extends beyond the loaded environment bounds, `fetchExpandedEnvironment()` requests fresh ArcGIS GeoJSON for the needed envelope and sends the merged environment back to the worker.
4. In live weather mode, `fetchWeatherGrid()` samples Open-Meteo at a 3x3 grid around the current map center.
5. Each settings or time change posts `{ settings, time, requestId, quick }` to the worker. While playback is running, `quick` mode uses a faster uncertainty proxy.
6. The worker returns cells, wind vectors, dog path, chamber coverage, signal curve, metrics, weather values, assumptions, and an explanation.
7. React renders the returned field through deck.gl layers and uses `buildChamberTwins()` to derive device-twin state for the chamber panel.

## Data Sources

### Static Environment Bundle

`public/gainesville-environment.json` is the bundled starting environment. Current summary:

| Layer | Count |
| --- | ---: |
| Roads | 100 |
| Buildings | 791 |
| Canopy polygons | 4 |
| Trees | 0 |
| Stormwater manholes | 169 |
| Stormwater network structures | 13 |
| Stormwater end structures | 68 |
| Stormwater clean outs | 15 |
| Stormwater drop inlets | 559 |
| Stormwater basins | 34 |
| Stormwater gravity mains | 775 |
| Stormwater open channels | 47 |
| Stormwater virtual mains | 90 |
| Stormwater ponds/features | 35 |
| Stormwater structure polygons | 63 |

Bundle metadata:

- `source`: `OpenStreetMap Overpass API; City of Gainesville StormwaterNetwork_AGO`
- `generatedAt`: `2026-07-16T22:21:56.397Z`
- `radiusMeters`: `750`
- Stormwater `fetchedAt`: `2026-07-16T22:21:52.122Z`
- Stormwater `queryRadiusMeters`: `1000`
- City data disclaimer in the JSON: informational, may be missing or inaccurate, and should be used only as modeled drainage influence.

### Dynamic ArcGIS Refreshes

When the current station layout needs more coverage, the app queries:

- Alachua County building footprints:
  `https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/Alachua_County_FL_Buildings/FeatureServer/0/query`
- City of Gainesville stormwater network:
  `https://services2.arcgis.com/Zzhtlau4ccHkQgTu/arcgis/rest/services/StormwaterNetwork_AGO/FeatureServer`

The stormwater service is queried by layer id:

| Key | Layer id | Modeled kind |
| --- | ---: | --- |
| `manholes` | 0 | manhole |
| `networkStructures` | 1 | network-structure |
| `endStructures` | 2 | outfall |
| `cleanOuts` | 3 | cleanout |
| `dropInlets` | 4 | inlet |
| `stormBasins` | 5 | basin |
| `pumps` | 6 | pump |
| `virtualEnds` | 7 | virtual-end |
| `gravityMains` | 8 | pipe |
| `openChannels` | 9 | channel |
| `virtualMains` | 10 | virtual-pipe |
| `stormPonds` | 11 | pond |
| `stormStructures` | 12 | structure polygon |

Dynamic refreshes use GeoJSON envelope queries with `resultRecordCount=2000`, normalize feature ids/titles/details, merge with static data, and tag the merged environment with `coverageSource: "dynamic-expanded"`.

### Live Weather

Live weather uses the Open-Meteo Forecast API:

- `current`: wind speed, wind direction, wind gusts, temperature, relative humidity, precipitation.
- `hourly`: the same variables for the 24-hour model.
- Units: wind speed in `m/s`, temperature in Fahrenheit.
- Timezone: `America/New_York`.
- Sampling pattern: 9 points in a 3x3 grid around the selected center.
- Sample span: `settings.radius * 1.25`, clamped from `350 m` to `1400 m`.

If live weather fails or manual mode is selected, the worker uses the UI sliders as the weather baseline.

### Basemap

The basemap comes from MapTiler:

- `satellite`: `https://api.maptiler.com/maps/satellite/style.json`
- `street`: `https://api.maptiler.com/maps/basic-v2/style.json`

Both require `NEXT_PUBLIC_MAPTILER_KEY`.

## Data Structures

### `EnvironmentData`

The environment object consumed by both the UI and worker has this shape:

```ts
type EnvironmentData = {
  source: string;
  generatedAt: string;
  bounds?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  coverageSource?: "static" | "dynamic-expanded" | string;
  radiusMeters: number;
  roads: FeatureCollection;
  buildings: FeatureCollection;
  canopy: FeatureCollection;
  trees: FeatureCollection;
  stormwater?: StormwaterData;
};
```

Each `FeatureCollection` contains GeoJSON `Point`, `LineString`, or `Polygon` features with properties such as `id`, `kind`, `title`, `detail`, `highway`, `building`, `surface`, and optional `heightMeters`.

### `StormwaterData`

```ts
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
```

### `Settings`

`Settings` is the main scenario state. It includes:

- Map center, radius, and basemap.
- Weather: wind direction, wind speed, gustiness, temperature, humidity, rain, sunlight, and `weatherSource`.
- Scenario coefficients: track age, contamination, surface type, stability, canopy, roughness, drainage, source strength, and building mode.
- `chambers`: an array of scent chamber station objects.

### `ScentChamber`

```ts
type ScentChamber = {
  id: string;
  name: string;
  road: string;
  lat: number;
  lon: number;
  scentStrength: number;
  foodStrength: number;
  ventHeight: number;
  ventDirection: number;
  leakRate: number;
  itemAge: number;
  rechargeHours: number;
  detectionRadius: number;
  active: boolean;
  preset?: "passive-mesh" | "vented-tote" | "food-scent-hybrid";
  scentArticle?: "clothing" | "blanket" | "toy" | "mixed";
  foodLevel?: number;
  batteryCharge?: number;
  solarExposure?: number;
  internalHumidityBias?: number;
  lastServiceHour?: number;
};
```

Defaults currently include Station A on `SW 44th Ave` and Station B on `SW 91st Dr`. Users can place additional chambers on the map.

### Worker Output

The worker returns:

- `cells`: normalized odor cells with `intensity`, `ground`, `air`, `drainage`, `uncertainty`, and dominant `layer`.
- `vectors`: local wind vectors.
- `dogPath`: a modeled path following higher signal samples.
- `obstacles`: nearby drainage features used as wake/channel influences.
- `chambers`: chamber coverage estimates.
- `signal`: 24-hour signal curve.
- `metrics`: detectability, area coverage, continuity, pockets, max signal, uncertainty, ground hold, airborne share, and drainage load.
- `weather`: weather values used for the current time.
- `assumptions` and `explanation`: human-readable model context displayed in the Output panel.

## Simulation Model Notes

The worker uses a local meter grid centered on the selected lat/lon. It converts between lon/lat and local meters, builds environment rasters, and simulates odor transport as particle/puff mass over an expanded solver domain.

Important model features:

- The selected radius is the analysis radius, not the full solver boundary.
- The solver domain expands beyond the selected radius, especially when chambers sit outside the central radius.
- Ground, air, and drainage are accumulated separately and then normalized into map cells.
- Building modes change how buildings block, wake, shade, and pool scent:
  - `normal`
  - `obstruction`
  - `wake`
  - `shade`
- Road, canopy, impervious, moisture, low-point, building-edge, and stormwater values influence transport and retention.
- Quick playback mode uses a faster uncertainty proxy. Non-quick solves include a small wind-sensitivity ensemble.
- Results are cached by settings, environment timestamp, weather grid timestamp, and chamber configuration.

## Chamber Twin Model

The chamber twin code in `lib/chamber-twin/` is separate from the odor-field worker. It derives device-like state from the chamber configuration, current time, weather, field coverage, and environment coverage:

- `battery`
- `solarInput`
- `foodLevel`
- `scentRemaining`
- `scentOutput`
- `attractantOutput`
- `internalTemperature`
- `internalHumidity`
- `detectionConfidence`
- `contaminationRisk`
- `serviceLoad`
- `coverage`
- `coverageStatus`

The panel then shows status, badges, event logs, and a recommendation for the selected chamber.

## Map Layers

The deck.gl overlay includes:

- Analysis radius outline.
- Canopy polygons and tree points.
- Extruded building polygons.
- Roads.
- Stormwater polygons, lines, and points.
- Odor field cells.
- Wind vectors.
- Modeled dog path.
- 3D indicators for the last known point and chamber stations.
- Chamber detection-footprint circles.
- Station labels.

Layer visibility is controlled from the Map tab.

## Testing

The current tests are smoke and regression checks:

- The vinext server render returns HTML with the expected title and app description.
- Source files still include the app controls, chamber flow, weather flow, environment refresh flow, worker markers, and key package dependencies.
- The static environment JSON has enough road, building, canopy, and stormwater data to support the current app assumptions.

Run:

```bash
npm test
```

## Deployment Notes

The project is configured for vinext/Cloudflare Worker style deployment. `worker/index.ts` delegates app handling to `vinext/server/app-router-entry` and supports vinext image optimization.

`.openai/hosting.json` is used by the Sites workflow and `vite.config.ts` reads it to simulate local D1/R2 bindings when present. The simulation itself currently does not require D1 or R2.

## Known Limitations

- Model coefficients are illustrative and should be validated before operational use.
- City/county GIS layers can be stale, incomplete, or inaccurate.
- Live weather is interpolated from a 3x3 sample grid and is not a street-level sensor network.
- The bundled static environment is centered on the current Gainesville use case.
- The app is client-heavy; the odor simulation runs in the browser worker.
- No persistent scenario storage exists yet, despite optional D1 plumbing being available.
