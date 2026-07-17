import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the scent simulation shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Scent Simulation<\/title>/i);
  assert.match(html, /Interactive geographic odor-field simulation/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("client app contains the forensic-local modeling controls", async () => {
  const [page, worker, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/odor-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Model control sections/);
  assert.match(page, /9318 SW 43rd Ln/);
  assert.match(page, /SW 44th Ave/);
  assert.match(page, /SW 91st Dr/);
  assert.match(page, /Add chamber/);
  assert.match(page, /Place on map/);
  assert.match(page, /Click map to place chamber/);
  assert.match(page, /addChamberAt/);
  assert.match(page, /removeChamber/);
  assert.match(page, /ControlTab/);
  assert.match(page, /panel-tabs/);
  assert.match(page, /ChamberTwinPanel/);
  assert.match(page, /buildChamberTwins/);
  assert.match(page, /createPlacedChamber/);
  assert.match(page, /stationLabel/);
  assert.match(page, /Environment coverage/);
  assert.match(page, /fetchExpandedEnvironment/);
  assert.match(page, /evaluateEnvironmentCoverage/);
  assert.match(page, /ALACHUA_BUILDINGS_URL/);
  assert.match(page, /GAINESVILLE_STORMWATER_URL/);
  assert.match(page, /coverage-pill/);
  assert.match(page, /ventDirection/);
  assert.match(page, /leakRate/);
  assert.match(page, /itemAge/);
  assert.match(page, /rechargeHours/);
  assert.match(page, /Analysis layers/);
  assert.match(page, /analysis radius/);
  assert.match(page, /Building influence/);
  assert.match(page, /stormwater/);
  assert.match(page, /Weather field/);
  assert.match(page, /Source and age model/);
  assert.match(page, /Source age/);
  assert.match(page, /Trail age/);
  assert.match(page, /Plume age/);
  assert.match(page, /Water pathway/);
  assert.match(page, /waterEnabled/);
  assert.match(page, /water-scent-zones/);
  assert.match(page, /surfaceDeposit/);
  assert.match(page, /reRelease/);
  assert.match(page, /waterSignal/);
  assert.match(page, /function ControlPanel\(\{[\s\S]*time,[\s\S]*time: number;/);
  assert.equal((page.match(/time=\{time\}/g) ?? []).length, 4);
  assert.match(page, /Temp/);
  assert.match(page, /Rain/);
  assert.match(page, /Open-Meteo Forecast API/);
  assert.match(page, /past_days/);
  assert.match(page, /fetchWeatherGrid/);
  assert.match(page, /scentThreshold\(scentView, settings\.radius\)/);
  assert.match(page, /outsideRadius/);
  assert.match(page, /layerToggles\.radius/);
  assert.doesNotMatch(page, /id: "obstacles"/);
  assert.doesNotMatch(page, /DRAIN/);
  assert.match(page, /simulationTime/);
  assert.match(page, /workerRequestId/);
  assert.match(page, /WORKER_VERSION/);
  assert.match(page, /Stability/);
  assert.match(page, /Drainage/);
  assert.match(page, /Uncertain/);
  assert.match(worker, /particle\/puff transport/);
  assert.match(worker, /sourceTypeProfile/);
  assert.match(worker, /ageProfile/);
  assert.match(worker, /sourceAgeHours/);
  assert.match(worker, /trailAgeHours/);
  assert.match(worker, /plumeAgeHours/);
  assert.match(worker, /sampleHourIndex/);
  assert.match(worker, /ageHours/);
  assert.match(worker, /surfaceDeposit/);
  assert.match(worker, /reRelease/);
  assert.match(worker, /waterSignal/);
  assert.match(worker, /buildWaterPath/);
  assert.match(worker, /underwater/);
  assert.match(worker, /surface/);
  assert.match(worker, /airborne/);
  assert.match(worker, /makeSources/);
  assert.match(worker, /ventDirection/);
  assert.match(worker, /leakRate/);
  assert.match(worker, /itemAge/);
  assert.match(worker, /recharge/);
  assert.match(worker, /buildChamberResults/);
  assert.match(worker, /activeChamberExtent/);
  assert.match(worker, /solverDomainRadius/);
  assert.match(worker, /addSourcePool/);
  assert.match(worker, /buildingModeCoefficients/);
  assert.match(worker, /settings\.buildingMode/);
  assert.match(worker, /ground: groundIntensity/);
  assert.match(worker, /signalGate/);
  assert.match(worker, /interpolateWeatherField/);
  assert.match(worker, /live-grid/);
  assert.match(worker, /Open-Meteo local weather grid/);
  assert.match(worker, /outputCutoff/);
  assert.match(worker, /analysisRadius >= 1000 \? 1800/);
  assert.match(worker, /0\.006/);
  assert.match(worker, /rawEnvironment\?\.stormwater/);
  assert.match(worker, /City stormwater network/);
  assert.match(worker, /avgBuilding/);
  assert.match(worker, /simulate\(settings, time/);
  assert.match(worker, /analysisRadius/);
  assert.match(worker, /domainRadius/);
  assert.match(worker, /expanded solver domain/);
  assert.match(worker, /selected radius is metric scale, not plume edge/);
  assert.match(worker, /outsideRadius/);
  assert.match(worker, /signalCache/);
  assert.match(worker, /fast motion uncertainty proxy/);
  assert.match(worker, /full uncertainty ensemble/);
  assert.match(worker, /particleScale/);
  assert.match(worker, /cached weather-score daily signal/);
  assert.match(worker, /environmentRasterCache = new Map/);
  assert.match(worker, /environmentModelCache = new Map/);
  assert.match(worker, /RASTER_CACHE_LIMIT/);
  assert.match(worker, /makeSpatialIndex/);
  assert.match(worker, /querySpatialIndex/);
  assert.match(worker, /nearBounds/);
  assert.match(worker, /Math\.sqrt\(extraSources\)/);
  assert.match(worker, /guaranteedSourcePasses/);
  assert.match(worker, /impervious/);
  assert.match(worker, /moisture/);
  assert.match(worker, /lowPoint/);
  assert.match(worker, /surfaceHold/);
  assert.match(worker, /per-station vent\/leak\/age\/recharge/);
  assert.match(worker, /impervious\/moisture\/low-point land-cover raster/);
  assert.match(packageJson, /"maplibre-gl"/);
  assert.match(packageJson, /"@deck\.gl\/layers"/);
  assert.match(packageJson, /"@turf\/turf"/);
  assert.match(packageJson, /"d3"/);
});

test("includes local mapped road, building, and canopy environment data", async () => {
  const environment = JSON.parse(await readFile(new URL("../public/gainesville-environment.json", import.meta.url), "utf8"));

  assert.equal(environment.roads.type, "FeatureCollection");
  assert.ok(environment.roads.features.length >= 20);
  assert.equal(environment.buildings.type, "FeatureCollection");
  assert.ok(environment.buildings.features.length >= 500);
  assert.equal(environment.canopy.type, "FeatureCollection");
  assert.ok(environment.canopy.features.length >= 1);
  assert.equal(environment.stormwater.gravityMains.type, "FeatureCollection");
  assert.ok(environment.stormwater.gravityMains.features.length >= 500);
  assert.equal(environment.stormwater.dropInlets.type, "FeatureCollection");
  assert.ok(environment.stormwater.dropInlets.features.length >= 300);
  assert.equal(environment.stormwater.openChannels.type, "FeatureCollection");
  assert.ok(environment.stormwater.openChannels.features.length >= 20);
});
