import type { ScentChamber } from "./types";

export function stationLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < alphabet.length) return alphabet[index];
  return `S${index + 1}`;
}

export function stationName(index: number) {
  return `Station ${stationLabel(index)}`;
}

export function createPlacedChamber({
  index,
  lat,
  lon,
  windDir,
  trackAge,
}: {
  index: number;
  lat: number;
  lon: number;
  windDir: number;
  trackAge: number;
}): ScentChamber {
  return {
    id: `custom-${Date.now()}-${index}`,
    name: stationName(index),
    road: "Custom chamber",
    lat,
    lon,
    scentStrength: 0.72,
    foodStrength: 0.36,
    ventHeight: 0.72,
    ventDirection: windDir,
    leakRate: 0.62,
    itemAge: trackAge,
    rechargeHours: 24,
    detectionRadius: 40,
    active: true,
    preset: "food-scent-hybrid",
    scentArticle: "mixed",
    foodLevel: 0.78,
    batteryCharge: 0.82,
    solarExposure: 0.64,
    internalHumidityBias: 0.04,
    lastServiceHour: 16,
  };
}
