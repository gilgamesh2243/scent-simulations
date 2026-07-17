import type { ChamberCoverageStatus, ChamberTwin, ChamberTwinLogEvent, ChamberTwinWeather, ScentChamber } from "./types";

type BuildChamberTwinOptions = {
  chambers: ScentChamber[];
  time: number;
  weather: ChamberTwinWeather;
  coverageById: Map<string, number>;
  coverageStatusById: Record<string, ChamberCoverageStatus | undefined>;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function daySolarCurve(hour: number) {
  return clamp(Math.sin(((hour - 6) / 12) * Math.PI), 0, 1);
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function eventHour(baseHour: number, offset: number) {
  return (baseHour + offset + 24) % 24;
}

function formatHour(hour: number) {
  const h = Math.floor(hour) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function makeLog(chamberId: string, hour: number, index: number, event: Omit<ChamberTwinLogEvent, "id" | "hour">): ChamberTwinLogEvent {
  return { ...event, id: `${chamberId}-${Math.round(hour * 100)}-${index}`, hour };
}

function sortByRecency(events: ChamberTwinLogEvent[], time: number) {
  return [...events].sort((a, b) => ((time - b.hour + 24) % 24) - ((time - a.hour + 24) % 24));
}

function buildLogs(chamber: ScentChamber, state: ChamberTwin["state"], time: number, weather: ChamberTwinWeather): ChamberTwinLogEvent[] {
  const seed = hashText(chamber.id);
  const motionA = eventHour(time, -((seed % 8) + 1.2));
  const motionB = eventHour(time, -(((seed >> 3) % 13) + 4.4));
  const serviceHour = chamber.lastServiceHour ?? eventHour(time, -(chamber.rechargeHours ?? 24));
  const logs: ChamberTwinLogEvent[] = [
    makeLog(chamber.id, serviceHour, 0, {
      label: "Service state estimated",
      detail: `${chamber.scentArticle ?? "mixed"} scent article age modeled at ${Math.round(chamber.itemAge)} h with ${Math.round(state.scentRemaining * 100)}% remaining signal.`,
      category: "service",
      severity: state.serviceLoad > 0.72 ? "watch" : "info",
    }),
    makeLog(chamber.id, eventHour(time, -2.1), 1, {
      label: "Scent output solved",
      detail: `Twin output ${Math.round(state.scentOutput * 100)}%; vent ${Math.round(chamber.ventDirection)} deg, leak ${Math.round(chamber.leakRate * 100)}%, height ${chamber.ventHeight.toFixed(1)} m.`,
      category: "scent",
      severity: state.scentOutput < 0.3 ? "watch" : "info",
    }),
    makeLog(chamber.id, eventHour(time, -1.4), 2, {
      label: "Local chamber climate",
      detail: `Internal model ${Math.round(state.internalTemperature)}F / ${Math.round(state.internalHumidity)}% RH from weather, solar exposure, and chamber humidity bias.`,
      category: "environment",
      severity: state.internalTemperature > 91 || state.internalHumidity < 35 ? "watch" : "info",
    }),
    makeLog(chamber.id, eventHour(time, -0.8), 3, {
      label: "Power budget updated",
      detail: `Battery ${Math.round(state.battery * 100)}%, solar input ${Math.round(state.solarInput * 100)}%, detection confidence ${Math.round(state.detectionConfidence * 100)}%.`,
      category: "power",
      severity: state.battery < 0.25 ? "critical" : state.battery < 0.42 ? "watch" : "info",
    }),
    makeLog(chamber.id, motionA, 4, {
      label: "PIR motion candidate",
      detail: `Simulated trigger inside ${chamber.detectionRadius} m footprint; classification confidence ${Math.round(state.detectionConfidence * 100)}%.`,
      category: "detection",
      severity: state.detectionConfidence < 0.45 ? "watch" : "info",
    }),
    makeLog(chamber.id, motionB, 5, {
      label: "Attractant plume contribution",
      detail: `Food level ${Math.round(state.foodLevel * 100)}%; modeled food odor contribution ${Math.round(state.attractantOutput * 100)}%.`,
      category: "food",
      severity: state.foodLevel < 0.22 ? "watch" : "info",
    }),
  ];

  if ((weather.rain ?? 0) > 0.18) {
    logs.push(
      makeLog(chamber.id, eventHour(time, -3.2), 6, {
        label: "Rain interaction",
        detail: "Rain increases ground retention but raises washout/relocation risk near drainage and low points.",
        category: "environment",
        severity: "watch",
      }),
    );
  }

  if (state.coverageStatus !== "mapped") {
    logs.push(
      makeLog(chamber.id, eventHour(time, -0.4), 7, {
        label: "Environment coverage warning",
        detail: state.coverageStatus === "edge" ? "Station sits near the loaded environment boundary." : "Station is outside reliable mapped environment coverage.",
        category: "environment",
        severity: state.coverageStatus === "sparse" ? "critical" : "watch",
      }),
    );
  }

  return sortByRecency(logs, time).slice(0, 7);
}

function badgesFor(state: ChamberTwin["state"]) {
  const badges = [state.status === "online" ? "active twin" : state.status];
  if (state.coverageStatus !== "mapped") badges.push(state.coverageStatus === "edge" ? "edge data" : "sparse data");
  if (state.scentOutput > 0.66) badges.push("strong output");
  if (state.contaminationRisk > 0.54) badges.push("contamination watch");
  if (state.detectionConfidence > 0.64) badges.push("recent activity ready");
  return badges.slice(0, 4);
}

function recommendationFor(state: ChamberTwin["state"]) {
  if (state.coverageStatus === "sparse") return "Repull/extend local environment before trusting this chamber's coverage.";
  if (state.scentOutput < 0.28) return "Refresh scent article or reduce heat exposure before relying on this chamber.";
  if (state.foodLevel < 0.2) return "Refill or disable food-attractant assumptions for this station.";
  if (state.battery < 0.28) return "Model as passive scent only unless power recovers.";
  if (state.contaminationRisk > 0.62) return "Treat recent detections with higher uncertainty until serviced.";
  return "Keep modeled position; current twin is adding useful local signal.";
}

export function buildChamberTwins({ chambers, time, weather, coverageById, coverageStatusById }: BuildChamberTwinOptions): ChamberTwin[] {
  const solarCurve = daySolarCurve(time);
  return chambers.map((chamber) => {
    const coverage = clamp(coverageById.get(chamber.id) ?? chamber.scentStrength);
    const coverageStatus = coverageStatusById[chamber.id] ?? "mapped";
    const solarExposure = clamp(chamber.solarExposure ?? 0.55, 0.08, 1);
    const batteryBase = clamp(chamber.batteryCharge ?? 0.78);
    const solarInput = clamp(solarCurve * solarExposure * (1 - (weather.rain ?? 0) * 0.35));
    const battery = clamp(batteryBase + solarInput * 0.22 - (chamber.active ? 0.08 : 0.02) - (time < 6 || time > 20 ? 0.05 : 0));
    const foodLevel = clamp(chamber.foodLevel ?? 0.72);
    const internalTemperature = weather.temperature + solarExposure * solarCurve * 9 - (weather.windSpeed ?? 2.5) * 0.35;
    const internalHumidity = clamp((weather.humidity + (chamber.internalHumidityBias ?? 0) * 100 + (weather.rain ?? 0) * 18 - solarCurve * 8) / 100) * 100;
    const ageRetention = Math.exp(-(chamber.itemAge ?? 0) / 72);
    const heatPenalty = internalTemperature > 86 ? clamp(1 - (internalTemperature - 86) / 45, 0.42, 1) : 1;
    const humiditySupport = clamp(0.68 + internalHumidity / 160, 0.55, 1.2);
    const recharge = clamp(1 - ((chamber.itemAge ?? 0) % Math.max(8, chamber.rechargeHours ?? 24)) / Math.max(8, chamber.rechargeHours ?? 24) * 0.34, 0.5, 1);
    const scentRemaining = clamp(chamber.scentStrength * ageRetention * heatPenalty * humiditySupport * recharge);
    const scentOutput = clamp(scentRemaining * chamber.leakRate * (chamber.active ? 1 : 0.12) * (0.75 + battery * 0.25));
    const attractantOutput = clamp(chamber.foodStrength * foodLevel * (0.72 + internalTemperature / 220) * (chamber.active ? 1 : 0.08));
    const detectionConfidence = clamp(coverage * (0.55 + battery * 0.36) * (coverageStatus === "mapped" ? 1 : coverageStatus === "edge" ? 0.78 : 0.42));
    const contaminationRisk = clamp((chamber.foodStrength * 0.26 + (weather.rain ?? 0) * 0.24 + (1 - detectionConfidence) * 0.28 + (chamber.itemAge / 96) * 0.22) * (chamber.active ? 1 : 0.4));
    const serviceLoad = clamp((1 - scentRemaining) * 0.52 + (1 - foodLevel) * 0.24 + (1 - battery) * 0.24);
    const status = !chamber.active ? "offline" : scentOutput < 0.26 ? "low-output" : battery < 0.3 || serviceLoad > 0.72 ? "watch" : "online";
    const state = {
      chamberId: chamber.id,
      status,
      battery,
      solarInput,
      foodLevel,
      scentRemaining,
      scentOutput,
      attractantOutput,
      internalTemperature,
      internalHumidity,
      detectionConfidence,
      contaminationRisk,
      serviceLoad,
      coverage,
      coverageStatus,
    } satisfies ChamberTwin["state"];
    return {
      chamber,
      state,
      logs: buildLogs(chamber, state, time, weather),
      badges: badgesFor(state),
      recommendation: recommendationFor(state),
    };
  });
}

export { formatHour };
