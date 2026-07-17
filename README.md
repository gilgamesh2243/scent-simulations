# Scent Simulation

Scent Simulation is an interactive map-based model for exploring how human scent, food attractants, wind, buildings, terrain, vegetation, water flow, and portable scent chambers may interact around a local search area.

The current scenario is centered near `9318 SW 43rd Ln` in Gainesville, Florida. The app is designed to help people ask better field-planning questions: where might scent hold, where might it disperse, what environmental features could matter, and how chamber placement changes the modeled picture.

This is a decision-support and visualization tool. It is not a forensic instrument, a guarantee of scent location, or a substitute for trained field judgment.

## Why This Exists

Search environments are messy. Scent can be affected by wind, temperature, humidity, sunlight, drainage, roads, building edges, vegetation, ground surface, and time. A flat map can show where things are, but it does not help much with how those factors might interact.

This project gives teams a way to:

- Compare possible scent movement scenarios.
- Visualize where scent may be stronger, weaker, uncertain, airborne, ground-held, or drainage-influenced.
- Test how portable scent chambers might extend or change the search picture.
- See how weather and environmental changes alter the model over a 24-hour period.
- Document what data sources and assumptions went into the analysis.

The goal is not to say "the answer is here." The goal is to make assumptions visible, compare options, and support clearer decisions.

## What You See On The Map

The main screen is a 3D map with adjustable model controls. Depending on which layers are turned on, the map can show:

- The last known point or central source location.
- A selected analysis radius.
- Roads and nearby structures.
- Building footprints and building-edge effects.
- Canopy and vegetation areas.
- Stormwater inlets, pipes, channels, ponds, and basins.
- Wind direction and strength across the area.
- Modeled scent intensity cells.
- Ground, air, drainage, and uncertainty views.
- A modeled path showing how a search track might follow stronger signal.
- Scent chamber stations and their detection footprints.

The map is meant to be explored. Changing time, weather, chamber placement, or visible layers can change the interpretation.

## How To Use It

1. Start with the map view.
   Confirm the center point, radius, and basemap. The default location is the Gainesville scenario built into the project.

2. Review the environment.
   Turn buildings, roads, stormwater, canopy, and chamber layers on or off to understand what mapped features are influencing the model.

3. Check weather assumptions.
   Use live weather when available, or switch to manual weather if you want to test a specific wind, rain, humidity, or temperature scenario.

4. Set the scent age model.
   Choose the source type and distinguish source age, trail age, and plume age. A continuing source, an older finite trail, and an odor parcel traveling away from the source are modeled differently.

5. Move through time.
   Use the 24-hour playback bar to see how the modeled field changes throughout the day.

6. Compare scent views.
   The combined view gives the broadest picture. Ground, air, drainage, deposited surface scent, re-release, water, and uncertainty views help explain why the model is showing that picture.

7. Add or remove chambers.
   Use chamber placement to test whether portable stations could improve modeled coverage, create stronger signal zones, or add uncertainty.

8. Read the output panel.
   The metrics and explanation summarize what the model thinks is driving the current result.

## How To Interpret The Main Views

### Combined

The combined view blends the major scent layers into one practical picture. Use it for a quick overview, then switch to the other views to understand why areas are highlighted.

### Ground

Ground scent represents modeled scent that is more likely to remain low or held by surfaces. It can increase around stable air, shade, moisture, canopy, and certain ground conditions.

### Air

Airborne scent represents modeled scent that has lifted or dispersed above the ground layer. It is more sensitive to wind speed, heat, impervious surfaces, and building wakes.

### Drainage

Drainage scent represents modeled movement or holding near stormwater structures, low points, channels, ponds, and rain-influenced corridors.

### Surface And Re-Release

Surface scent represents odor that has deposited onto soil, vegetation, pavement, or objects. Re-release represents deposited odor becoming airborne again when warming, drying, airflow, wave action, or moisture changes make that plausible.

### Water

Water scent appears when submerged-source modeling is enabled. The map separates underwater transport, surface emergence, and airborne detection. A canine alert in this view should not be read as the precise underwater source location.

### Uncertainty

Uncertainty highlights areas where the model is less confident. High uncertainty can come from wind shifts, contamination assumptions, fast-changing weather, mixed layers, or sparse environment coverage.

## Scent Chambers

The app includes portable scent chamber stations. These are modeled as controlled scent and food-attractant sources with their own device-like state.

Each chamber can affect the model through:

- Location.
- Scent strength.
- Food-attractant strength.
- Vent height and direction.
- Leak rate.
- Age of scent article.
- Recharge or service interval.
- Detection radius.
- Active or inactive state.

The chamber panel shows a "device twin" for the selected chamber. This is a simulated status summary, not a live hardware feed. It estimates:

- Scent output.
- Food-attractant contribution.
- Power reserve.
- Internal temperature and humidity.
- Detection confidence.
- Contamination risk.
- Service load.
- Environment coverage quality.
- Recent modeled event log.
- Suggested action or caution.

## Data Sources

The model combines bundled local data with live or refreshed external data when available.

### Local Environment Bundle

The project includes a starting environment file at `public/gainesville-environment.json`. It contains mapped features near the Gainesville scenario:

| Data Layer | Current Count |
| --- | ---: |
| Roads | 100 |
| Building footprints | 791 |
| Canopy polygons | 4 |
| Trees | 0 |
| Stormwater manholes | 169 |
| Stormwater network structures | 13 |
| Stormwater end structures / outfalls | 68 |
| Stormwater clean outs | 15 |
| Stormwater drop inlets | 559 |
| Stormwater basins | 34 |
| Stormwater gravity mains | 775 |
| Stormwater open channels | 47 |
| Stormwater virtual mains | 90 |
| Stormwater ponds or features | 35 |
| Stormwater structure polygons | 63 |

Bundle metadata:

- Sources: OpenStreetMap Overpass API and City of Gainesville stormwater data.
- Generated: `2026-07-16T22:21:56.397Z`.
- Stormwater data fetched: `2026-07-16T22:21:52.122Z`.
- Starting local environment radius: `750 m`.
- Stormwater query radius: `1000 m`.

The city data is informational and may contain missing or inaccurate assets. In this app it is used as modeled environmental influence, not surveyed ground truth.

### Dynamic Map Refresh

If the selected radius or chamber layout extends beyond the bundled data area, the app attempts to refresh key layers from public ArcGIS services:

- Alachua County building footprints.
- City of Gainesville stormwater network.

The refreshed data is merged with the bundled environment so the model has better local coverage for the current station layout.

### Weather

Live weather comes from the Open-Meteo Forecast API. The app samples a 3 by 3 grid around the selected center point and uses:

- Wind speed.
- Wind direction.
- Wind gusts.
- Temperature.
- Relative humidity.
- Precipitation.

The app requests enough recent hourly weather history to cover the selected source, trail, and plume age window. If live weather is unavailable, or if manual mode is selected, the model uses the weather sliders in the app.

### Basemap

The visual basemap comes from MapTiler. A MapTiler API key is required for satellite or street basemap tiles.

## What The Model Considers

The simulation uses a local meter grid around the selected center point. It estimates how scent mass moves and changes over time under the selected conditions.

It considers:

- Source type: moving live person, stationary live person, finite training aid, animal, decomposition source, or submerged source.
- Source age: how long a continuing source has been producing odor.
- Trail age: how long ago a moving source passed through a location.
- Plume age: how long an odor parcel has been traveling away from its source.
- Wind direction, speed, and gustiness.
- Temperature, humidity, rain, and sunlight.
- Recent weather history across the selected age window.
- Surface type and roughness.
- Track or scent age.
- Contamination assumptions.
- Building obstruction, wake, shade, and edge effects.
- Roads and impervious surfaces.
- Canopy and vegetation.
- Surface deposition and later re-release.
- Stormwater and low-point drainage influence.
- Underwater current, depth, mixing, wave action, turbulence, buoyancy, salinity, and surface-to-air transfer when water modeling is enabled.
- Chamber venting, leak rate, scent age, food attractant, and detection radius.

The model separates scent into ground, air, drainage, deposited surface, re-release, and water-related components, then combines them into practical map views.

## What The Metrics Mean

- Detect: how strong the modeled signal is compared with the selected source assumptions.
- Area: how much of the selected radius has meaningful modeled signal.
- Trail: how continuous the modeled signal is for track-following.
- Uncertain: how unstable or assumption-sensitive the result is.
- Ground: share of signal held near the ground layer.
- Airborne: share of signal lifted or dispersed through air.
- Drainage: share of signal influenced by rain, low points, and stormwater.
- Deposited: share of signal held on surfaces.
- Re-release: share of previously deposited odor modeled as becoming airborne again.
- Water: share of signal tied to the underwater-to-surface-to-air pathway.
- Pockets: stronger but uncertain local concentrations.

These metrics are best used for comparison between scenarios, not as absolute measurements.

## What This Is Not

This project does not claim to predict exactly where scent is located. It does not replace:

- Human search planning.
- Handler judgment.
- Ground truth observation.
- Weather station data at the exact site.
- Official GIS or survey records.
- Legal, forensic, or emergency-response protocols.

Use it to explore, compare, and communicate assumptions.

## Running The App Locally

Requirements:

- Node.js `>=22.13.0`.
- A MapTiler API key for the basemap.

Common commands:

```bash
npm install
npm run dev
npm test
```

Set the basemap key in your local environment:

```bash
NEXT_PUBLIC_MAPTILER_KEY=your_key_here
```

The app can render controls without the key, but the map tiles will not load correctly.

## Project Layout

For readers who need to maintain or audit the project:

```text
app/                     Main user interface, map controls, data loading, and visualization
components/              Reusable interface pieces, including the chamber twin panel
lib/chamber-twin/        Chamber state model, recommendations, and event log simulation
public/                  Static assets, the odor worker, and Gainesville environment data
worker/                  Cloudflare/vinext server entry point
db/                      Optional database wiring, currently not used by the simulation
tests/                   Build, render, source-marker, and environment-data checks
```

The main simulation workload runs in `public/odor-worker.js` so the map interface can stay responsive while scenarios are recalculated.

## Current Validation

The test suite checks that:

- The app server-renders successfully.
- The expected scent simulation controls are present.
- The worker still includes the major modeling paths.
- The bundled Gainesville environment has enough roads, buildings, canopy, and stormwater data for the current scenario.

Run:

```bash
npm test
```

## Known Limitations

- The coefficients are illustrative and should be validated before operational use.
- Public GIS layers can be stale, incomplete, or inaccurate.
- Live weather is interpolated from nearby forecast samples, not from sensors at every point on the map.
- The current bundled environment is specific to the Gainesville scenario.
- Chamber device status is simulated, not connected to physical hardware.
- The water model is a simplified planning model, not a hydrodynamic survey.
- Scenarios are not yet saved persistently.

## Bottom Line

Scent Simulation is a way to make environmental assumptions visible. It helps people see why a scent picture might change, what mapped features could matter, and how different chamber or weather scenarios compare. Treat the output as a structured conversation with the environment, not a final answer.
