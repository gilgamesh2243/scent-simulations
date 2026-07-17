"use client";

import { Activity, BatteryCharging, Camera, Gauge, Utensils, Wind } from "lucide-react";
import type { ReactNode } from "react";

import { formatHour } from "@/lib/chamber-twin/simulator";
import type { ChamberTwin } from "@/lib/chamber-twin/types";

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function severityLabel(severity: ChamberTwin["logs"][number]["severity"]) {
  if (severity === "critical") return "critical";
  if (severity === "watch") return "watch";
  return "info";
}

function metricTone(value: number, inverse = false) {
  const score = inverse ? 1 - value : value;
  if (score > 0.66) return "good";
  if (score > 0.38) return "watch";
  return "critical";
}

function statusTone(status: ChamberTwin["state"]["status"]) {
  if (status === "online") return "online";
  if (status === "watch") return "watch";
  return "critical";
}

function MetricBar({
  icon,
  label,
  value,
  detail,
  inverse,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  inverse?: boolean;
}) {
  const tone = metricTone(value, inverse);
  return (
    <div className={`metric-bar-row ${tone}`}>
      <div className="metric-bar-icon">{icon}</div>
      <div className="metric-bar-body">
        <div className="metric-bar-top">
          <span>{label}</span>
          <strong>{pct(value)}</strong>
        </div>
        <div className="metric-track" aria-hidden="true">
          <i style={{ width: pct(value) }} />
        </div>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function ChamberTwinPanel({
  twins,
  selectedId,
}: {
  twins: ChamberTwin[];
  selectedId: string | null;
}) {
  if (!twins.length) {
    return (
      <section className="control-card chamber-twin-card">
        <div className="section-title">
          <Activity size={17} />
          Chamber twin system
        </div>
        <p className="microcopy">Add chambers to generate simulated device state, event logs, and output contribution.</p>
      </section>
    );
  }

  const selected = twins.find((twin) => twin.chamber.id === selectedId) ?? twins[0];
  const deviceStatus = statusTone(selected.state.status);
  const scentDetail = `${selected.chamber.scentArticle ?? "mixed"} article, ${Math.round(selected.chamber.itemAge)} h old`;
  const powerDetail = `${pct(selected.state.solarInput)} solar input, ${Math.round(selected.state.internalTemperature)}F internal`;

  return (
    <section className="control-card chamber-twin-card">
      <div className="twin-device-header">
        <div>
          <span className="eyebrow">Chamber device twin</span>
          <h2>{selected.chamber.name}</h2>
          <p>{selected.chamber.road}</p>
        </div>
        <span className={`device-status ${deviceStatus}`}>
          <i />
          {selected.state.status}
        </span>
      </div>

      <div className="device-toolbar">
        <div className="device-profile">
          <div>
            <span>Vent</span>
            <strong>{Math.round(selected.chamber.ventDirection)} deg</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{selected.chamber.preset ?? "field chamber"}</strong>
          </div>
          <div>
            <span>Coverage</span>
            <strong>{selected.state.coverageStatus}</strong>
          </div>
        </div>
      </div>

      <div className="device-health-panel">
        <MetricBar icon={<Wind size={16} />} label="Scent output" value={selected.state.scentOutput} detail={scentDetail} />
        <MetricBar icon={<Utensils size={16} />} label="Food attractant" value={selected.state.foodLevel} detail={`Food odor contribution ${pct(selected.state.attractantOutput)}`} />
        <MetricBar icon={<BatteryCharging size={16} />} label="Power reserve" value={selected.state.battery} detail={powerDetail} />
        <MetricBar icon={<Camera size={16} />} label="Detection confidence" value={selected.state.detectionConfidence} detail={`${selected.chamber.detectionRadius} m PIR/camera footprint`} />
        <MetricBar icon={<Gauge size={16} />} label="Contamination risk" value={selected.state.contaminationRisk} detail="Higher values add uncertainty to station events" inverse />
        <MetricBar icon={<Gauge size={16} />} label="Service load" value={selected.state.serviceLoad} detail="Maintenance pressure from scent, food, and power" inverse />
      </div>

      <div className="device-system-strip">
        <div>
          <span>Internal temp</span>
          <strong>{Math.round(selected.state.internalTemperature)}F</strong>
        </div>
        <div>
          <span>Internal RH</span>
          <strong>{Math.round(selected.state.internalHumidity)}%</strong>
        </div>
        <div>
          <span>Solar input</span>
          <strong>{pct(selected.state.solarInput)}</strong>
        </div>
        <div>
          <span>Leak rate</span>
          <strong>{pct(selected.chamber.leakRate)}</strong>
        </div>
      </div>

      <div className="twin-badges">
        {selected.badges.map((badge) => (
          <span key={badge} className={`twin-badge ${badge.includes("sparse") || badge.includes("low") ? "watch" : ""}`}>
            {badge}
          </span>
        ))}
      </div>

      <p className="twin-recommendation">{selected.recommendation}</p>

      <div className="twin-log">
        <div className="event-stream-title">
          <Activity size={15} />
          Simulated device event stream
        </div>
        {selected.logs.map((event) => (
          <div className={`twin-log-row ${severityLabel(event.severity)}`} key={event.id}>
            <time>{formatHour(event.hour)}</time>
            <div>
              <strong>{event.label}</strong>
              <span>{event.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
