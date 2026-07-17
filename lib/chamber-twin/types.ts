export type ChamberPreset = "passive-mesh" | "vented-tote" | "food-scent-hybrid";
export type ScentArticle = "clothing" | "blanket" | "toy" | "mixed";
export type ChamberCoverageStatus = "mapped" | "edge" | "sparse";
export type ChamberLogSeverity = "info" | "watch" | "critical";
export type ChamberLogCategory = "scent" | "food" | "power" | "detection" | "environment" | "service";

export type ScentChamber = {
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
  preset?: ChamberPreset;
  scentArticle?: ScentArticle;
  foodLevel?: number;
  batteryCharge?: number;
  solarExposure?: number;
  internalHumidityBias?: number;
  lastServiceHour?: number;
};

export type ChamberTwinWeather = {
  temperature: number;
  humidity: number;
  rain?: number;
  windSpeed?: number;
  windDir?: number;
};

export type ChamberTwinLogEvent = {
  id: string;
  hour: number;
  label: string;
  detail: string;
  category: ChamberLogCategory;
  severity: ChamberLogSeverity;
};

export type ChamberTwinState = {
  chamberId: string;
  status: "online" | "watch" | "low-output" | "offline";
  battery: number;
  solarInput: number;
  foodLevel: number;
  scentRemaining: number;
  scentOutput: number;
  attractantOutput: number;
  internalTemperature: number;
  internalHumidity: number;
  detectionConfidence: number;
  contaminationRisk: number;
  serviceLoad: number;
  coverage: number;
  coverageStatus: ChamberCoverageStatus;
};

export type ChamberTwin = {
  chamber: ScentChamber;
  state: ChamberTwinState;
  logs: ChamberTwinLogEvent[];
  badges: string[];
  recommendation: string;
};
