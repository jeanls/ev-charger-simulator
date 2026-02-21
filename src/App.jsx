import { useState, useEffect, useRef, useCallback } from "react";

// ─── OCPP 2.0.1 ──────────────────────────────────────────────────────────────
const OCPP_MSG = { CALL: 2, CALLRESULT: 3, CALLERROR: 4 };

const EVSE_STATUS = {
    Available: "Available", Preparing: "Preparing", Charging: "Charging",
    SuspendedEVSE: "SuspendedEVSE", SuspendedEV: "SuspendedEV",
    Finishing: "Finishing", Reserved: "Reserved", Unavailable: "Unavailable", Faulted: "Faulted",
};

const STATUS_COLOR = {
    Available: "#00e5a0", Preparing: "#f0c040", Charging: "#00b4ff",
    SuspendedEVSE: "#ff9800", SuspendedEV: "#ff9800", Finishing: "#a78bfa",
    Reserved: "#f472b6", Unavailable: "#6b7280", Faulted: "#ef4444",
};

// OCPP 2.0.1 Component Error Codes
const ERROR_CODES = [
    { code: "ConnectorLockFailure",   desc: "Falha no travamento do conector" },
    { code: "EVCommunicationError",   desc: "Erro de comunicação com o veículo" },
    { code: "GroundFailure",          desc: "Falha de aterramento detectada" },
    { code: "HighTemperature",        desc: "Temperatura acima do limite" },
    { code: "InternalError",          desc: "Erro interno do hardware" },
    { code: "LocalListConflict",      desc: "Conflito na lista local" },
    { code: "NoError",                desc: "Sem erros (limpar fault)" },
    { code: "OtherError",             desc: "Outro erro não categorizado" },
    { code: "OverCurrentFailure",     desc: "Sobrecorrente detectada" },
    { code: "OverVoltage",            desc: "Sobretensão detectada" },
    { code: "PowerMeterFailure",      desc: "Falha no medidor de energia" },
    { code: "PowerSwitchFailure",     desc: "Falha no switch de potência" },
    { code: "ReaderFailure",          desc: "Falha no leitor RFID" },
    { code: "ResetFailure",           desc: "Falha ao reiniciar" },
    { code: "UnderVoltage",           desc: "Subtensão detectada" },
    { code: "WeakSignal",             desc: "Sinal de comunicação fraco" },
];

function uid() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function now() { return new Date().toISOString(); }

// ─── Curva de carga não-linear (simula curva CC real) ────────────────────────
// Retorna multiplicador de potência (0.0 - 1.0) baseado no SOC atual
function chargeCurve(soc) {
    if (soc < 20)  return 0.75 + (soc / 20) * 0.25;   // rampa inicial 75%→100%
    if (soc < 80)  return 1.0;                           // plateau: potência máxima
    if (soc < 90)  return 1.0 - ((soc - 80) / 10) * 0.55; // declínio 100%→45%
    if (soc < 95)  return 0.45 - ((soc - 90) / 5) * 0.25; // 45%→20%
    return 0.20 - ((soc - 95) / 5) * 0.15;              // 20%→5% em 95-100%
}

// ─── Simulação de temperatura ────────────────────────────────────────────────
// Temperatura sobe com a carga, resfria quando parada
function updateTemp(currentTemp, powerKw, maxPower, ambientTemp = 25) {
    const load = powerKw / maxPower;
    const heatRate = load * 0.08;          // aquecimento por tick (°C/s)
    const coolRate = (currentTemp - ambientTemp) * 0.012; // resfriamento proporcional
    return Math.max(ambientTemp, Math.min(85, currentTemp + heatRate - coolRate));
}

// Temperatura acima de 60°C começa a limitar a potência
function tempDerating(temp) {
    if (temp < 60) return 1.0;
    if (temp < 75) return 1.0 - ((temp - 60) / 15) * 0.4;
    return 0.6 - ((temp - 75) / 10) * 0.4;
}

// ─── Estado inicial de um EVSE ───────────────────────────────────────────────
function createEvse(id, connectorType = "CCS2") {
    return {
        id,
        connectorType,
        status: EVSE_STATUS.Available,
        session: null,
        temperature: 28,
        fault: null,         // { errorCode, info, timestamp }
        power: 0,
    };
}

// ─── Componente: Mini display de EVSE ────────────────────────────────────────
function EvseCard({ evse, config, onStart, onStop, onFault, onClearFault, selected, onClick }) {
    const color = STATUS_COLOR[evse.status] || "#6b7280";
    const isCharging = evse.status === EVSE_STATUS.Charging;
    const isFaulted = evse.status === EVSE_STATUS.Faulted;
    const tempColor = evse.temperature > 70 ? "#ef4444" : evse.temperature > 55 ? "#ff9800" : "#00b4ff";

    return (
        <div
            onClick={onClick}
            style={{
                background: selected ? "#0d1a2a" : "#080d18",
                border: `2px solid ${selected ? color : color + "44"}`,
                borderRadius: 14,
                padding: "14px 14px 12px",
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: selected ? `0 0 20px ${color}22` : "none",
                position: "relative",
                overflow: "hidden",
            }}
        >
            {isCharging && (
                <div style={{ position: "absolute", top: 0, left: "-100%", width: "60%", height: "100%", background: `linear-gradient(90deg, transparent, ${color}10, transparent)`, animation: "sweep 2.5s infinite" }} />
            )}

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, animation: isCharging ? "pulse 1.2s infinite" : "none" }} />
                    <span style={{ fontFamily: "monospace", fontSize: 10, color, fontWeight: 700, letterSpacing: 1 }}>EVSE {evse.id}</span>
                </div>
                <span style={{ fontFamily: "monospace", fontSize: 9, color: "#2a4a6a", letterSpacing: 1 }}>{evse.connectorType}</span>
            </div>

            {/* Status badge */}
            <div style={{ fontFamily: "monospace", fontSize: 9, color: color, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10, opacity: 0.85 }}>
                {isFaulted ? `⚠ ${evse.fault?.errorCode || "Faulted"}` : evse.status}
            </div>

            {/* SOC bar */}
            <div style={{ marginBottom: 8 }}>
                <div style={{ height: 4, background: "#1a2535", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${evse.session?.soc ?? 0}%`, background: `linear-gradient(90deg, #00e5a0, #00b4ff)`, transition: "width 0.8s ease" }} />
                </div>
            </div>

            {/* Métricas */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                {[
                    { label: "SOC", value: `${(evse.session?.soc ?? 0).toFixed(0)}%`, color: "#00e5a0" },
                    { label: "kW", value: evse.power.toFixed(1), color: "#f0c040" },
                    { label: "°C", value: evse.temperature.toFixed(0), color: tempColor },
                ].map(({ label, value, color: c }) => (
                    <div key={label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color: c }}>{value}</div>
                        <div style={{ fontSize: 8, color: "#2a4a6a", letterSpacing: 1 }}>{label}</div>
                    </div>
                ))}
            </div>

            {/* Ações */}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {evse.status === EVSE_STATUS.Available && (
                    <button onClick={(e) => { e.stopPropagation(); onStart(evse.id); }}
                            style={{ flex: 1, padding: "5px 0", background: "#00b4ff18", border: "1px solid #00b4ff44", borderRadius: 5, color: "#00b4ff", fontSize: 9, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1 }}>
                        ▶ START
                    </button>
                )}
                {(evse.status === EVSE_STATUS.Charging || evse.status === EVSE_STATUS.Preparing) && (
                    <button onClick={(e) => { e.stopPropagation(); onStop(evse.id); }}
                            style={{ flex: 1, padding: "5px 0", background: "#ef444418", border: "1px solid #ef444444", borderRadius: 5, color: "#ef4444", fontSize: 9, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1 }}>
                        ■ STOP
                    </button>
                )}
                {isFaulted ? (
                    <button onClick={(e) => { e.stopPropagation(); onClearFault(evse.id); }}
                            style={{ flex: 1, padding: "5px 0", background: "#00e5a018", border: "1px solid #00e5a044", borderRadius: 5, color: "#00e5a0", fontSize: 9, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1 }}>
                        ✓ CLEAR
                    </button>
                ) : (
                    <button onClick={(e) => { e.stopPropagation(); onFault(evse.id); }}
                            style={{ flex: 1, padding: "5px 0", background: "#ef444418", border: "1px solid #ef444422", borderRadius: 5, color: "#ef444488", fontSize: 9, fontFamily: "monospace", cursor: "pointer", letterSpacing: 1 }}>
                        ⚠ FAULT
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── Gauge SVG ────────────────────────────────────────────────────────────────
function Gauge({ value, max, label, unit, color }) {
    const r = 38, circ = 2 * Math.PI * r;
    const dash = Math.min(value / max, 1) * circ * 0.75;
    const offset = circ * 0.125;
    return (
        <div style={{ textAlign: "center" }}>
            <svg width={96} height={96} viewBox="0 0 96 96">
                <circle cx={48} cy={48} r={r} fill="none" stroke="#1a2535" strokeWidth={8} strokeDasharray={`${circ * 0.75} ${circ}`} strokeDashoffset={-offset} strokeLinecap="round" />
                <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={8} strokeDasharray={`${dash} ${circ}`} strokeDashoffset={-offset} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }} />
                <text x={48} y={45} textAnchor="middle" fill="#e0eaf8" fontSize={15} fontWeight="700" fontFamily="monospace">{typeof value === "number" ? value.toFixed(1) : value}</text>
                <text x={48} y={58} textAnchor="middle" fill="#5a7a9a" fontSize={9} fontFamily="monospace">{unit}</text>
            </svg>
            <div style={{ marginTop: -4, fontSize: 10, color: "#6a8aaa", fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
        </div>
    );
}

// ─── Termômetro visual ────────────────────────────────────────────────────────
function Thermometer({ temp }) {
    const pct = Math.min((temp - 20) / 70, 1); // 20°C → 90°C
    const color = temp > 70 ? "#ef4444" : temp > 55 ? "#ff9800" : temp > 40 ? "#f0c040" : "#00b4ff";
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ width: 14, height: 80, background: "#1a2535", borderRadius: 7, overflow: "hidden", position: "relative", border: "1px solid #2a3a4a" }}>
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct * 100}%`, background: color, transition: "height 1s ease, background 1s ease", borderRadius: "0 0 7px 7px" }} />
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5 }}>{temp.toFixed(0)}°C</div>
            <div style={{ fontFamily: "monospace", fontSize: 8, color: "#3a5a7a", letterSpacing: 1 }}>TEMP</div>
        </div>
    );
}

// ─── Modal de Injeção de Falhas ───────────────────────────────────────────────
function FaultModal({ evseId, onInject, onClose }) {
    const [selected, setSelected] = useState("GroundFailure");
    const [info, setInfo] = useState("");

    return (
        <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div style={{ background: "#0a0f1a", border: "2px solid #ef444444", borderRadius: 16, padding: 24, width: 420, maxHeight: "80vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                        <div style={{ fontFamily: "monospace", fontSize: 9, color: "#ef4444", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>⚠ Injetar Falha</div>
                        <div style={{ fontFamily: "monospace", fontSize: 14, color: "#e0eaf8", fontWeight: 700 }}>EVSE {evseId}</div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#3a5a7a", fontSize: 18, cursor: "pointer" }}>✕</button>
                </div>

                <div style={{ marginBottom: 16 }}>
                    <label style={{ fontFamily: "monospace", fontSize: 9, color: "#4a6a8a", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Error Code</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {ERROR_CODES.map(({ code, desc }) => (
                            <div key={code}
                                 onClick={() => setSelected(code)}
                                 style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 6, background: selected === code ? "#1a0a0a" : "#0d1520", border: `1px solid ${selected === code ? "#ef4444" : "#1a2535"}`, cursor: "pointer", transition: "all 0.15s" }}
                            >
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: selected === code ? "#ef4444" : "#2a3a4a", flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontFamily: "monospace", fontSize: 11, color: selected === code ? "#ef4444" : "#8ab0d0", fontWeight: selected === code ? 700 : 400 }}>{code}</div>
                                    <div style={{ fontFamily: "monospace", fontSize: 9, color: "#3a5a7a" }}>{desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ fontFamily: "monospace", fontSize: 9, color: "#4a6a8a", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Info adicional (opcional)</label>
                    <input value={info} onChange={e => setInfo(e.target.value)} placeholder="ex: Temperatura: 82°C"
                           style={{ width: "100%", background: "#0d1520", border: "1px solid #1e2a3a", borderRadius: 6, color: "#c0cce0", padding: "8px 10px", fontFamily: "monospace", fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={onClose}
                            style={{ flex: 1, padding: "10px 0", background: "transparent", border: "1px solid #1e2a3a", borderRadius: 8, color: "#3a5a7a", fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                        Cancelar
                    </button>
                    <button onClick={() => { onInject(evseId, selected, info); onClose(); }}
                            style={{ flex: 1, padding: "10px 0", background: "#ef444418", border: "1px solid #ef444466", borderRadius: 8, color: "#ef4444", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}>
                        ⚠ INJETAR FALHA
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Log Panel ────────────────────────────────────────────────────────────────
function LogPanel({ logs }) {
    const ref = useRef();
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
    return (
        <div ref={ref} style={{ background: "#0a0e1a", border: "1px solid #1e2a3a", borderRadius: 8, height: 240, overflowY: "auto", padding: "10px 14px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7 }}>
            {logs.length === 0 && <span style={{ color: "#3a4a5a" }}>Aguardando mensagens OCPP...</span>}
            {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                    <span style={{ color: "#3a5a7a" }}>{log.time} </span>
                    {log.evseId && <span style={{ color: "#2a5a7a" }}>[E{log.evseId}] </span>}
                    <span style={{ color: log.dir === "TX" ? "#00e5a0" : log.dir === "RX" ? "#00b4ff" : log.dir === "CSMS" ? "#f472b6" : log.dir === "FAULT" ? "#ef4444" : log.dir === "ERR" ? "#ff6060" : "#a0a0b0" }}>
            [{log.dir}]
          </span>{" "}
                    <span style={{ color: "#c0cce0" }}>{log.msg}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────
function ConfigPanel({ config, onChange, connected }) {
    const field = (label, key, type = "text", opts = {}) => (
        <div style={{ marginBottom: 12 }} key={key}>
            <label style={{ display: "block", fontFamily: "monospace", fontSize: 10, color: "#4a6a8a", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>{label}</label>
            {opts.select ? (
                <select value={config[key]} onChange={(e) => onChange(key, e.target.value)} disabled={connected} style={{ ...iStyle(connected), display: "block" }}>
                    {opts.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : (
                <input type={type} value={config[key]} onChange={(e) => onChange(key, type === "number" ? +e.target.value : e.target.value)}
                       disabled={connected} style={iStyle(connected)} min={opts.min} max={opts.max} />
            )}
        </div>
    );

    const socRange = config.socEnd - config.socStart;
    const energyNeeded = (socRange / 100) * config.batteryCapacity;
    const estPower = config.chargeDurationMin > 0 ? (energyNeeded / (config.chargeDurationMin / 60)).toFixed(1) : "—";

    return (
        <div>
            <SectionLabel>Conexão</SectionLabel>
            {field("CSMS URL", "csmsUrl")}
            {field("Station ID", "stationId")}
            {field("Heartbeat Interval (s)", "heartbeatInterval", "number", { min: 10, max: 300 })}

            <SectionLabel style={{ marginTop: 16 }}>Hardware</SectionLabel>
            {field("Fabricante", "vendor")}
            {field("Modelo", "model")}
            {field("Número de Série", "serialNumber")}
            {field("Potência Máx por EVSE (kW)", "maxPower", "number", { min: 1, max: 350 })}
            {field("Voltagem (V)", "voltage", "number", { min: 100, max: 1000 })}
            {field("Número de EVSEs", "evseCount", "number", { min: 1, max: 4 })}
            {field("Tipo de Conector Padrão", "connectorType", "text", { select: true, options: ["CCS2", "CHAdeMO", "Type2", "Tesla", "GB/T"] })}

            <SectionLabel style={{ marginTop: 16, color: "#00b4ff88" }}>⚡ Simulação de Carga</SectionLabel>
            {field("Capacidade da Bateria (kWh)", "batteryCapacity", "number", { min: 5, max: 200 })}
            {field("SOC Inicial (%)", "socStart", "number", { min: 0, max: 99 })}
            {field("SOC Final (%)", "socEnd", "number", { min: 1, max: 100 })}
            {field("Tempo para completar (min)", "chargeDurationMin", "number", { min: 1, max: 480 })}
            <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontFamily: "monospace", fontSize: 10, color: "#4a6a8a", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>Curva de Carga</label>
                <div style={{ display: "flex", gap: 8 }}>
                    {["linear", "nonlinear"].map(v => (
                        <div key={v} onClick={() => onChange("chargeMode", v)}
                             style={{ flex: 1, textAlign: "center", padding: "8px", borderRadius: 6, background: config.chargeMode === v ? "#0a1a2a" : "#080d18", border: `1px solid ${config.chargeMode === v ? "#00b4ff" : "#1a2535"}`, color: config.chargeMode === v ? "#00b4ff" : "#3a5a7a", fontFamily: "monospace", fontSize: 10, cursor: "pointer", transition: "all 0.2s" }}>
                            {v === "linear" ? "📏 Linear" : "📈 Não-linear"}
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ background: "#070c14", border: "1px solid #0d2a1a", borderRadius: 8, padding: "10px 12px", marginTop: 4 }}>
                <SectionLabel>Preview</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}>
                    {[
                        { l: "SOC", v: `${config.socStart}% → ${config.socEnd}%`, c: "#00e5a0" },
                        { l: "Duração", v: `${config.chargeDurationMin} min`, c: "#a78bfa" },
                        { l: "Energia", v: `${energyNeeded.toFixed(1)} kWh`, c: "#00b4ff" },
                        { l: "Pot. média", v: `${estPower} kW`, c: "#f0c040" },
                    ].map(({ l, v, c }) => (
                        <div key={l} style={{ padding: "4px 0" }}>
                            <div style={{ fontSize: 8, color: "#2a4a3a", letterSpacing: 1, textTransform: "uppercase" }}>{l}</div>
                            <div style={{ fontSize: 13, color: c, fontWeight: 700, fontFamily: "monospace" }}>{v}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function SectionLabel({ children, style: s }) {
    return <div style={{ fontSize: 9, letterSpacing: 2, color: "#1e3a5a", textTransform: "uppercase", paddingBottom: 5, borderBottom: "1px solid #0d1a2a", marginBottom: 10, ...s }}>{children}</div>;
}

function SectionTitle({ children, style: s }) {
    return <div style={{ fontSize: 9, letterSpacing: 2, color: "#2a4a6a", textTransform: "uppercase", borderBottom: "1px solid #1a2535", paddingBottom: 6, marginBottom: 10, ...s }}>{children}</div>;
}

const iStyle = (disabled) => ({
    width: "100%", background: disabled ? "#0a0f1a" : "#0d1520", border: "1px solid #1e2a3a",
    borderRadius: 6, color: disabled ? "#3a5a7a" : "#c0cce0", padding: "7px 10px",
    fontFamily: "monospace", fontSize: 12, outline: "none", boxSizing: "border-box",
});

function InfoGrid({ items }) {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
            {items.map((item, i) => (
                <div key={i} style={{ background: "#080d18", border: "1px solid #121d2a", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: item.color || "#8ab0d0", fontWeight: 600, wordBreak: "break-all" }}>{item.value}</div>
                </div>
            ))}
        </div>
    );
}

function btnStyle(color, disabled = false) {
    return {
        width: "100%", padding: "10px 14px", background: disabled ? "#0a0f1a" : `${color}18`,
        border: `1px solid ${disabled ? "#1a2535" : color + "44"}`, borderRadius: 8,
        color: disabled ? "#2a3a50" : color, fontFamily: "monospace", fontSize: 11,
        fontWeight: 700, letterSpacing: 1.5, cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.2s", textTransform: "uppercase",
    };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
    const [config, setConfig] = useState({
        csmsUrl: "ws://localhost:9000/ocpp",
        stationId: "EVCS-001",
        vendor: "VoltCore Systems",
        model: "VC-150DC",
        serialNumber: "VC2024000001",
        maxPower: 50,
        connectorType: "CCS2",
        heartbeatInterval: 30,
        voltage: 400,
        batteryCapacity: 60,
        socStart: 20,
        socEnd: 100,
        chargeDurationMin: 5,
        evseCount: 2,
        chargeMode: "nonlinear",
    });

    const [evses, setEvses] = useState([createEvse(1, "CCS2"), createEvse(2, "CHAdeMO")]);
    const [connected, setConnected] = useState(false);
    const [simMode, setSimMode] = useState(false);
    const [logs, setLogs] = useState([]);
    const [tab, setTab] = useState("monitor");
    const [selectedEvse, setSelectedEvse] = useState(1);
    const [idTagInput, setIdTagInput] = useState("USER001");
    const [faultModalEvse, setFaultModalEvse] = useState(null);

    const wsRef = useRef(null);
    const heartbeatRef = useRef(null);
    const meterRefs = useRef({});   // { evseId: intervalId }
    const evseRef = useRef(evses);
    const configRef = useRef(config);
    configRef.current = config;
    evseRef.current = evses;

    // Sync evseCount → evses array
    useEffect(() => {
        if (connected) return;
        setEvses(prev => {
            const count = config.evseCount;
            const connTypes = ["CCS2", "CHAdeMO", "Type2", "Tesla"];
            const next = Array.from({ length: count }, (_, i) => {
                const existing = prev.find(e => e.id === i + 1);
                return existing || createEvse(i + 1, connTypes[i] || config.connectorType);
            });
            return next;
        });
    }, [config.evseCount, connected]);

    // Tick para atualizar temperaturas mesmo sem sessão
    useEffect(() => {
        const t = setInterval(() => {
            setEvses(prev => prev.map(e => ({
                ...e,
                temperature: updateTemp(e.temperature, e.power, configRef.current.maxPower),
            })));
        }, 1000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => () => {
        clearInterval(heartbeatRef.current);
        Object.values(meterRefs.current).forEach(clearInterval);
    }, []);

    const addLog = useCallback((dir, msg, evseId = null) => {
        const time = new Date().toLocaleTimeString("pt-BR");
        setLogs(prev => [...prev.slice(-300), { dir, msg, time, evseId }]);
    }, []);

    const updateEvse = useCallback((id, patch) => {
        setEvses(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    }, []);

    // ── OCPP Send ──────────────────────────────────────────────────────────────
    const simulateCsmsResponse = useCallback((action) => {
        let r = {};
        if (action === "BootNotification") r = { currentTime: now(), interval: configRef.current.heartbeatInterval, status: "Accepted" };
        else if (action === "Heartbeat") r = { currentTime: now() };
        else if (action === "Authorize") r = { idTokenInfo: { status: "Accepted" } };
        else if (action === "TransactionEvent") r = { idTokenInfo: { status: "Accepted" } };
        addLog("RX", `${action}Response ← ${JSON.stringify(r).slice(0, 100)}`);
    }, [addLog]);

    const sendOCPP = useCallback((action, payload, evseId = null) => {
        addLog("TX", `${action} → ${JSON.stringify(payload).slice(0, 120)}`, evseId);
        if (simMode || !wsRef.current) {
            setTimeout(() => simulateCsmsResponse(action), 350);
        } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify([OCPP_MSG.CALL, uid(), action, payload]));
        }
    }, [simMode, addLog, simulateCsmsResponse]);

    const replyOCPP = useCallback((msgId, payload) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify([OCPP_MSG.CALLRESULT, msgId, payload]));
            addLog("TX", `CallResult [${msgId}] → ${JSON.stringify(payload).slice(0, 80)}`);
        }
    }, [addLog]);

    // ── Início de sessão ───────────────────────────────────────────────────────
    const doStartSession = useCallback((evseId, idTag) => {
        const cfg = configRef.current;
        const evse = evseRef.current.find(e => e.id === evseId);
        if (!evse || evse.status !== EVSE_STATUS.Available) return;

        const txId = uid();
        const socRange = cfg.socEnd - cfg.socStart;
        const totalEnergy = (socRange / 100) * cfg.batteryCapacity;
        const totalSeconds = cfg.chargeDurationMin * 60;

        const session = { startTime: Date.now(), energy: 0, soc: cfg.socStart, transactionId: txId, idTag, totalSeconds, socEnd: cfg.socEnd };
        updateEvse(evseId, { status: EVSE_STATUS.Preparing, session, power: 0 });
        addLog("SYS", `Sessão iniciada | EVSE ${evseId} | txId=${txId} | ${cfg.socStart}%→${cfg.socEnd}% | ${cfg.chargeDurationMin}min`, evseId);
        sendOCPP("Authorize", { idToken: { idToken: idTag, type: "ISO14443" } }, evseId);

        setTimeout(() => {
            // Verificar se não foi cancelado
            const currentEvse = evseRef.current.find(e => e.id === evseId);
            if (!currentEvse?.session) return;

            updateEvse(evseId, { status: EVSE_STATUS.Charging });
            sendOCPP("TransactionEvent", {
                eventType: "Started", timestamp: now(), triggerReason: "Authorized", seqNo: 0,
                transactionInfo: { transactionId: txId, chargingState: "Charging" },
                idToken: { idToken: idTag, type: "ISO14443" },
                evse: { id: evseId, connectorId: 1 },
                meterValue: [{ timestamp: now(), sampledValue: [{ value: 0, measurand: "Energy.Active.Import.Register", unit: "Wh" }] }],
            }, evseId);

            let seqNo = 1;

            meterRefs.current[evseId] = setInterval(() => {
                setEvses(prev => {
                    const evse = prev.find(e => e.id === evseId);
                    if (!evse?.session || evse.status === EVSE_STATUS.Faulted) return prev;

                    const ses = evse.session;
                    const currentCfg = configRef.current;

                    // Curva não-linear + derating por temperatura
                    const curveMult = currentCfg.chargeMode === "nonlinear" ? chargeCurve(ses.soc) : 1.0;
                    const tempMult = tempDerating(evse.temperature);
                    const effectivePower = currentCfg.maxPower * curveMult * tempMult;

                    // Calcular incremento real baseado na energia total necessária e tempo configurado
                    const energyPerSecBase = totalEnergy / totalSeconds;
                    const energyInc = energyPerSecBase * curveMult * tempMult;
                    const socInc = (socRange / totalSeconds) * curveMult * tempMult;

                    const newSoc = Math.min(ses.soc + socInc, currentCfg.socEnd);
                    const newEnergy = ses.energy + energyInc;
                    const newTemp = updateTemp(evse.temperature, effectivePower, currentCfg.maxPower);
                    const updatedSession = { ...ses, energy: newEnergy, soc: newSoc };

                    // MeterValues periódico (a cada ~30 energia incrementos)
                    if (Math.floor(newEnergy * 100) % 30 === 0) {
                        sendOCPP("MeterValues", {
                            evseId, transactionId: txId,
                            meterValue: [{ timestamp: now(), sampledValue: [
                                    { value: Math.round(newEnergy * 1000), measurand: "Energy.Active.Import.Register", unit: "Wh" },
                                    { value: Math.round(effectivePower * 1000), measurand: "Power.Active.Import", unit: "W" },
                                    { value: newSoc.toFixed(1), measurand: "SoC", unit: "Percent" },
                                    { value: newTemp.toFixed(1), measurand: "Temperature", unit: "Celsius" },
                                ]}],
                        }, evseId);
                        seqNo++;
                    }

                    // SOC atingiu o alvo
                    if (newSoc >= currentCfg.socEnd) {
                        clearInterval(meterRefs.current[evseId]);
                        addLog("SYS", `✅ EVSE ${evseId} — SOC ${currentCfg.socEnd}% atingido. Encerrando...`, evseId);
                        setTimeout(() => {
                            sendOCPP("TransactionEvent", {
                                eventType: "Ended", timestamp: now(), triggerReason: "EVDeparted", seqNo: 99,
                                transactionInfo: { transactionId: txId, chargingState: "Idle", stoppedReason: "EVDisconnected" },
                                meterValue: [{ timestamp: now(), sampledValue: [
                                        { value: Math.round(newEnergy * 1000), measurand: "Energy.Active.Import.Register", unit: "Wh" },
                                        { value: currentCfg.socEnd, measurand: "SoC", unit: "Percent" },
                                    ]}],
                            }, evseId);
                            sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId, connectorId: 1 }, evseId);
                            setEvses(p => p.map(e => e.id === evseId ? { ...e, status: EVSE_STATUS.Finishing, session: updatedSession, power: 0 } : e));
                            setTimeout(() => setEvses(p => p.map(e => e.id === evseId ? { ...e, status: EVSE_STATUS.Available, session: null, power: 0 } : e)), 2000);
                        }, 500);

                        return prev.map(e => e.id === evseId ? { ...e, session: updatedSession, power: effectivePower, temperature: newTemp } : e);
                    }

                    return prev.map(e => e.id === evseId ? { ...e, session: updatedSession, power: effectivePower, temperature: newTemp } : e);
                });
            }, 1000);
        }, 1500);
    }, [addLog, sendOCPP, updateEvse]);

    // ── Parar sessão ───────────────────────────────────────────────────────────
    const doStopSession = useCallback((evseId, reason = "Local") => {
        clearInterval(meterRefs.current[evseId]);
        const evse = evseRef.current.find(e => e.id === evseId);
        if (!evse?.session) return false;
        const ses = evse.session;
        addLog("SYS", `Sessão encerrada | EVSE ${evseId} | ${reason} | ${ses.energy.toFixed(3)} kWh`, evseId);
        sendOCPP("TransactionEvent", {
            eventType: "Ended", timestamp: now(),
            triggerReason: reason === "Remote" ? "RemoteStop" : "StopAuthorized", seqNo: 99,
            transactionInfo: { transactionId: ses.transactionId, chargingState: "Idle", stoppedReason: reason },
            meterValue: [{ timestamp: now(), sampledValue: [
                    { value: Math.round(ses.energy * 1000), measurand: "Energy.Active.Import.Register", unit: "Wh" },
                    { value: ses.soc.toFixed(1), measurand: "SoC", unit: "Percent" },
                ]}],
        }, evseId);
        updateEvse(evseId, { status: EVSE_STATUS.Finishing, power: 0 });
        setTimeout(() => {
            updateEvse(evseId, { status: EVSE_STATUS.Available, session: null, power: 0 });
            sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId, connectorId: 1 }, evseId);
        }, 2000);
        return true;
    }, [addLog, sendOCPP, updateEvse]);

    // ── Injetar falha ──────────────────────────────────────────────────────────
    const injectFault = useCallback((evseId, errorCode, info = "") => {
        clearInterval(meterRefs.current[evseId]);
        const evse = evseRef.current.find(e => e.id === evseId);
        const fault = { errorCode, info, timestamp: now() };

        if (evse?.session) {
            // Encerrar sessão ativa com erro
            sendOCPP("TransactionEvent", {
                eventType: "Ended", timestamp: now(), triggerReason: "AbnormalCondition", seqNo: 99,
                transactionInfo: { transactionId: evse.session.transactionId, chargingState: "Idle", stoppedReason: "ImmediateReset" },
            }, evseId);
        }

        sendOCPP("StatusNotification", {
            timestamp: now(), connectorStatus: "Faulted",
            evseId, connectorId: 1,
        }, evseId);

        // OCPP 2.0.1: NotifyEvent para reportar o erro
        sendOCPP("NotifyEvent", {
            generatedAt: now(),
            seqNo: 1,
            eventData: [{
                eventId: Math.floor(Math.random() * 9999),
                timestamp: now(),
                trigger: "Alerting",
                actualValue: errorCode,
                eventNotificationType: "HardWiredNotification",
                component: { name: "Connector", evse: { id: evseId, connectorId: 1 } },
                variable: { name: "Active" },
            }],
        }, evseId);

        addLog("FAULT", `⚠ EVSE ${evseId} → ${errorCode}${info ? ` (${info})` : ""}`, evseId);
        updateEvse(evseId, { status: EVSE_STATUS.Faulted, fault, session: null, power: 0 });
    }, [addLog, sendOCPP, updateEvse]);

    const clearFault = useCallback((evseId) => {
        updateEvse(evseId, { status: EVSE_STATUS.Available, fault: null, power: 0 });
        sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId, connectorId: 1 }, evseId);
        addLog("SYS", `EVSE ${evseId} — falha limpa, status: Available`, evseId);
    }, [updateEvse, sendOCPP, addLog]);

    // ── Handler CSMS → Charger ─────────────────────────────────────────────────
    const handleCsmsMessage = useCallback((data) => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { addLog("ERR", "Mensagem inválida"); return; }
        const [type, msgId, ...rest] = parsed;

        if (type === OCPP_MSG.CALLRESULT) { addLog("RX", `CallResult [${msgId}] ← ${JSON.stringify(rest[0]).slice(0, 100)}`); return; }
        if (type === OCPP_MSG.CALLERROR) { addLog("ERR", `CallError ← ${JSON.stringify(rest).slice(0, 100)}`); return; }

        if (type === OCPP_MSG.CALL) {
            const [action, payload] = rest;
            addLog("CSMS", `${action} ← ${JSON.stringify(payload).slice(0, 120)}`);

            switch (action) {
                case "RequestStartTransaction": {
                    const evseId = payload?.evseId ?? 1;
                    const evse = evseRef.current.find(e => e.id === evseId);
                    if (!evse || evse.status !== EVSE_STATUS.Available) { replyOCPP(msgId, { status: "Rejected" }); return; }
                    replyOCPP(msgId, { status: "Accepted" });
                    doStartSession(evseId, payload?.idToken?.idToken || "REMOTE");
                    break;
                }
                case "RequestStopTransaction": {
                    const txId = payload?.transactionId;
                    const evse = evseRef.current.find(e => e.session?.transactionId === txId);
                    if (!evse) { replyOCPP(msgId, { status: "Rejected" }); return; }
                    replyOCPP(msgId, { status: "Accepted" });
                    doStopSession(evse.id, "Remote");
                    break;
                }
                case "Reset": {
                    replyOCPP(msgId, { status: "Accepted" });
                    evseRef.current.forEach(e => { if (e.session) doStopSession(e.id, "Remote"); });
                    setTimeout(() => {
                        setEvses(evseRef.current.map(e => ({ ...e, status: EVSE_STATUS.Available, session: null, power: 0, fault: null })));
                        sendOCPP("BootNotification", { reason: "RemoteReset", chargingStation: { serialNumber: configRef.current.serialNumber, model: configRef.current.model, vendorName: configRef.current.vendor, firmwareVersion: "2.1.4" } });
                    }, 1500);
                    break;
                }
                case "ChangeAvailability": {
                    const evseId = payload?.evseId ?? 1;
                    const newStatus = payload?.operationalStatus === "Inoperative" ? EVSE_STATUS.Unavailable : EVSE_STATUS.Available;
                    replyOCPP(msgId, { status: "Accepted" });
                    updateEvse(evseId, { status: newStatus });
                    sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: newStatus, evseId, connectorId: 1 }, evseId);
                    break;
                }
                case "TriggerMessage": {
                    replyOCPP(msgId, { status: "Accepted" });
                    const msg = payload?.requestedMessage;
                    const evseId = payload?.evse?.id ?? 1;
                    if (msg === "Heartbeat") sendOCPP("Heartbeat", {});
                    if (msg === "StatusNotification") { const e = evseRef.current.find(x => x.id === evseId); sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: e?.status || "Available", evseId, connectorId: 1 }, evseId); }
                    break;
                }
                default:
                    if (wsRef.current?.readyState === WebSocket.OPEN)
                        wsRef.current.send(JSON.stringify([OCPP_MSG.CALLERROR, msgId, "NotImplemented", `${action} not supported`, {}]));
            }
        }
    }, [addLog, replyOCPP, doStartSession, doStopSession, updateEvse, sendOCPP]);

    const sendBoot = useCallback(() => {
        sendOCPP("BootNotification", { reason: "PowerUp", chargingStation: { serialNumber: configRef.current.serialNumber, model: configRef.current.model, vendorName: configRef.current.vendor, firmwareVersion: "2.1.4" } });
        evseRef.current.forEach(e => sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId: e.id, connectorId: 1 }, e.id));
    }, [sendOCPP]);

    const connect = useCallback((sim) => {
        if (sim) {
            addLog("SYS", "[SIM] Conectado ao CSMS simulado");
            setConnected(true); setSimMode(true);
            setEvses(prev => prev.map(e => ({ ...e, status: EVSE_STATUS.Available })));
            setTimeout(sendBoot, 300);
            heartbeatRef.current = setInterval(() => sendOCPP("Heartbeat", {}), configRef.current.heartbeatInterval * 1000);
            return;
        }
        try {
            const ws = new WebSocket(configRef.current.csmsUrl, ["ocpp2.0.1"]);
            wsRef.current = ws;
            ws.onopen = () => { addLog("SYS", `Conectado a ${configRef.current.csmsUrl}`); setConnected(true); setEvses(prev => prev.map(e => ({ ...e, status: EVSE_STATUS.Available }))); setTimeout(sendBoot, 300); heartbeatRef.current = setInterval(() => sendOCPP("Heartbeat", {}), configRef.current.heartbeatInterval * 1000); };
            ws.onmessage = (e) => handleCsmsMessage(e.data);
            ws.onerror = () => addLog("ERR", "Erro de WebSocket");
            ws.onclose = () => { addLog("SYS", "Conexão encerrada"); setConnected(false); clearInterval(heartbeatRef.current); };
        } catch (e) { addLog("ERR", `Falha: ${e.message}`); }
    }, [addLog, sendBoot, sendOCPP, handleCsmsMessage]);

    const disconnect = useCallback(() => {
        clearInterval(heartbeatRef.current);
        Object.values(meterRefs.current).forEach(clearInterval);
        evseRef.current.forEach(e => { if (e.session) doStopSession(e.id); });
        if (wsRef.current) wsRef.current.close();
        setConnected(false); setSimMode(false);
        setEvses(prev => prev.map(e => ({ ...e, status: EVSE_STATUS.Unavailable, session: null, power: 0 })));
        addLog("SYS", "Desconectado");
    }, [doStopSession, addLog]);

    const selEvse = evses.find(e => e.id === selectedEvse) || evses[0];
    const totalPower = evses.reduce((s, e) => s + e.power, 0);
    const activeSessions = evses.filter(e => e.session).length;
    const configChange = (k, v) => setConfig(c => ({ ...c, [k]: v }));

    const sessionElapsed = (ses) => {
        if (!ses) return "00:00";
        const s = Math.floor((Date.now() - ses.startTime) / 1000);
        return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}`;
    };

    return (
        <>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #060a12; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes sweep { 0%{left:-100%} 100%{left:200%} }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: #0a0e1a; } ::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 4px; }
        select, input { font-family: monospace !important; }
      `}</style>

            {faultModalEvse && <FaultModal evseId={faultModalEvse} onInject={injectFault} onClose={() => setFaultModalEvse(null)} />}

            <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 20% 50%, #0a1525 0%, #060a12 60%)", color: "#c0cce0", fontFamily: "'JetBrains Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: "28px 16px" }}>

                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <div style={{ fontSize: 10, letterSpacing: 6, color: "#2a4a6a", marginBottom: 4, textTransform: "uppercase" }}>Simulador OCPP 2.0.1</div>
                    <div style={{ fontSize: 24, fontWeight: 800, background: "linear-gradient(90deg, #00e5a0, #00b4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 2 }}>EV Charging Station</div>
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontSize: 11, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00e5a0" : "#ef4444", boxShadow: connected ? "0 0 6px #00e5a0" : "0 0 6px #ef4444", animation: connected ? "pulse 2s infinite" : "none" }} />
                            <span style={{ color: connected ? "#00e5a0" : "#ef4444" }}>{connected ? "Online" : "Offline"}</span>
                        </div>
                        <span style={{ color: "#1a2a3a" }}>|</span>
                        <span style={{ color: "#3a5a7a" }}>{config.stationId}</span>
                        <span style={{ color: "#1a2a3a" }}>|</span>
                        <span style={{ color: "#2a6a4a" }}>{evses.length} EVSEs</span>
                        <span style={{ color: "#1a2a3a" }}>|</span>
                        <span style={{ color: "#f0c040" }}>{totalPower.toFixed(1)} kW total</span>
                        <span style={{ color: "#1a2a3a" }}>|</span>
                        <span style={{ color: "#a78bfa" }}>{activeSessions} sessão(ões) ativa(s)</span>
                        {simMode && <><span style={{ color: "#1a2a3a" }}>|</span><span style={{ color: "#f0c040", fontSize: 10 }}>⚙ SIM</span></>}
                        {config.chargeMode === "nonlinear" && <><span style={{ color: "#1a2a3a" }}>|</span><span style={{ color: "#00b4ff", fontSize: 10 }}>📈 Curva não-linear</span></>}
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, maxWidth: 960, width: "100%" }}>

                    {/* Left: EVSEs + Controles */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                        {/* EVSEs */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {evses.map(evse => (
                                <EvseCard
                                    key={evse.id}
                                    evse={evse}
                                    config={config}
                                    selected={selectedEvse === evse.id}
                                    onClick={() => setSelectedEvse(evse.id)}
                                    onStart={(id) => connected && doStartSession(id, idTagInput)}
                                    onStop={(id) => doStopSession(id)}
                                    onFault={(id) => setFaultModalEvse(id)}
                                    onClearFault={(id) => clearFault(id)}
                                />
                            ))}
                        </div>

                        {/* Gauge cluster para EVSE selecionado */}
                        <div style={{ background: "#080d18", borderRadius: 12, padding: "12px 8px", border: "1px solid #1a2535" }}>
                            <div style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10, textAlign: "center" }}>EVSE {selectedEvse} — Métricas</div>
                            <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
                                <Gauge value={selEvse?.power ?? 0} max={config.maxPower} label="Potência" unit="kW" color="#00b4ff" />
                                <Thermometer temp={selEvse?.temperature ?? 28} />
                                <Gauge value={selEvse?.session?.soc ?? 0} max={100} label="SOC" unit="%" color="#00e5a0" />
                            </div>
                            {config.chargeMode === "nonlinear" && selEvse?.session && (
                                <div style={{ marginTop: 10, padding: "6px 10px", background: "#0a0f1a", borderRadius: 6, border: "1px solid #1a2535" }}>
                                    <div style={{ fontSize: 9, color: "#2a5a7a", marginBottom: 4, letterSpacing: 1 }}>CURVA DE CARGA</div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <div style={{ flex: 1, height: 3, background: "#1a2535", borderRadius: 2, overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${chargeCurve(selEvse.session.soc) * 100}%`, background: "linear-gradient(90deg, #00b4ff, #00e5a0)", transition: "width 1s ease" }} />
                                        </div>
                                        <span style={{ fontSize: 10, color: "#00b4ff", fontFamily: "monospace", minWidth: 36 }}>{(chargeCurve(selEvse.session.soc) * 100).toFixed(0)}%</span>
                                    </div>
                                    <div style={{ fontSize: 8, color: "#2a4a6a", marginTop: 3 }}>
                                        Multiplicador de potência no SOC atual ({selEvse.session.soc.toFixed(0)}%)
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ID Tag + Conexão */}
                        <div>
                            <label style={{ fontSize: 9, color: "#3a5a7a", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 4 }}>ID Tag</label>
                            <input value={idTagInput} onChange={(e) => setIdTagInput(e.target.value)} style={iStyle(false)} placeholder="USER001" />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {!connected ? (
                                <>
                                    <button onClick={() => connect(false)} style={btnStyle("#00e5a0")}>⚡ Conectar WS Real</button>
                                    <button onClick={() => connect(true)} style={btnStyle("#f0c040")}>⚙ Modo Simulado</button>
                                </>
                            ) : (
                                <button onClick={disconnect} style={btnStyle("#6b7280")}>✕ Desconectar</button>
                            )}
                        </div>

                        {/* Presets rápidos */}
                        {!connected && (
                            <div style={{ background: "#080d18", border: "1px solid #0d2a1a", borderRadius: 8, padding: "10px" }}>
                                <div style={{ fontSize: 9, color: "#2a5a3a", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>Presets</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                    {[
                                        { label: "20→100%\n5min", s: 20, e: 100, m: 5 },
                                        { label: "10→80%\n3min", s: 10, e: 80, m: 3 },
                                        { label: "0→100%\n10min", s: 0, e: 100, m: 10 },
                                        { label: "50→100%\n8min", s: 50, e: 100, m: 8 },
                                    ].map(p => (
                                        <button key={p.label} onClick={() => setConfig(c => ({ ...c, socStart: p.s, socEnd: p.e, chargeDurationMin: p.m }))}
                                                style={{ background: "#0a1520", border: "1px solid #1a3a2a", borderRadius: 6, color: "#00e5a0", fontSize: 9, padding: "6px 4px", cursor: "pointer", fontFamily: "monospace", lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: "center" }}>
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: Tabs */}
                    <div>
                        <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                            {["monitor", "config", "logs"].map(t => (
                                <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 16px", background: tab === t ? "#0d1520" : "transparent", border: `1px solid ${tab === t ? "#1e3a5a" : "#1a2535"}`, borderRadius: 6, color: tab === t ? "#00b4ff" : "#3a5a7a", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>{t}</button>
                            ))}
                        </div>

                        {/* ── Monitor ── */}
                        {tab === "monitor" && (
                            <div>
                                {/* Resumo geral */}
                                <SectionTitle>Resumo da Estação</SectionTitle>
                                <InfoGrid items={[
                                    { label: "EVSEs totais", value: evses.length, color: "#00e5a0" },
                                    { label: "Sessões ativas", value: activeSessions, color: "#00b4ff" },
                                    { label: "Potência total", value: `${totalPower.toFixed(2)} kW`, color: "#f0c040" },
                                    { label: "Falhas ativas", value: evses.filter(e => e.status === EVSE_STATUS.Faulted).length, color: evses.some(e => e.status === EVSE_STATUS.Faulted) ? "#ef4444" : "#3a5a7a" },
                                    { label: "Protocolo", value: "OCPP 2.0.1" },
                                    { label: "Curva", value: config.chargeMode === "nonlinear" ? "Não-linear CC" : "Linear" },
                                ]} />

                                {/* EVSE selecionado */}
                                <SectionTitle style={{ marginTop: 20 }}>EVSE {selectedEvse} — {selEvse?.status}</SectionTitle>
                                <InfoGrid items={[
                                    { label: "Status", value: selEvse?.status, color: STATUS_COLOR[selEvse?.status] },
                                    { label: "Conector", value: selEvse?.connectorType },
                                    { label: "Potência", value: `${(selEvse?.power ?? 0).toFixed(2)} kW`, color: "#f0c040" },
                                    { label: "Temperatura", value: `${(selEvse?.temperature ?? 0).toFixed(1)}°C`, color: selEvse?.temperature > 65 ? "#ef4444" : selEvse?.temperature > 50 ? "#ff9800" : "#00b4ff" },
                                    ...(selEvse?.fault ? [
                                        { label: "Erro", value: selEvse.fault.errorCode, color: "#ef4444" },
                                        { label: "Info", value: selEvse.fault.info || "—", color: "#ef444488" },
                                    ] : []),
                                ]} />

                                {selEvse?.session && (
                                    <>
                                        <SectionTitle style={{ marginTop: 20 }}>Sessão Ativa — EVSE {selectedEvse}</SectionTitle>
                                        <InfoGrid items={[
                                            { label: "Transaction ID", value: selEvse.session.transactionId },
                                            { label: "ID Tag", value: selEvse.session.idTag },
                                            { label: "Energia", value: `${selEvse.session.energy.toFixed(3)} kWh`, color: "#00b4ff" },
                                            { label: "SOC Atual", value: `${selEvse.session.soc.toFixed(1)}%`, color: "#00e5a0" },
                                            { label: "SOC Alvo", value: `${config.socEnd}%`, color: "#f0c040" },
                                            { label: "Duração", value: sessionElapsed(selEvse.session), color: "#a78bfa" },
                                            { label: "Pot. efetiva", value: `${(selEvse.power).toFixed(1)} kW (${((selEvse.power / config.maxPower) * 100).toFixed(0)}%)`, color: "#f0c040" },
                                            { label: "Custo Est.", value: `R$ ${(selEvse.session.energy * 1.5).toFixed(2)}` },
                                        ]} />
                                    </>
                                )}

                                {/* Comandos CSMS */}
                                <SectionTitle style={{ marginTop: 20 }}>Comandos CSMS Suportados</SectionTitle>
                                <div style={{ background: "#080d18", border: "1px solid #121d2a", borderRadius: 8, padding: "10px 14px" }}>
                                    {[
                                        { cmd: "RequestStartTransaction", desc: "Inicia sessão — {evseId, idToken}", color: "#00b4ff" },
                                        { cmd: "RequestStopTransaction", desc: "Para sessão — {transactionId}", color: "#ef4444" },
                                        { cmd: "Reset", desc: "Reinicia estação — {type: Immediate|OnIdle}", color: "#f0c040" },
                                        { cmd: "ChangeAvailability", desc: "Operative/Inoperative — {evseId}", color: "#a78bfa" },
                                        { cmd: "TriggerMessage", desc: "Forçar envio — {requestedMessage}", color: "#00e5a0" },
                                    ].map(({ cmd, desc, color: c }) => (
                                        <div key={cmd} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #0d1520" }}>
                                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: c, marginTop: 5, flexShrink: 0 }} />
                                            <div>
                                                <div style={{ fontSize: 11, color: c, fontFamily: "monospace", fontWeight: 700 }}>{cmd}</div>
                                                <div style={{ fontSize: 9, color: "#3a5a7a", marginTop: 2 }}>{desc}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Config ── */}
                        {tab === "config" && (
                            <div style={{ background: "#080d18", border: "1px solid #1a2535", borderRadius: 10, padding: 20, overflowY: "auto", maxHeight: 620 }}>
                                {connected && <div style={{ background: "#1a1500", border: "1px solid #3a2a00", borderRadius: 6, padding: "8px 12px", fontSize: 10, color: "#f0c040", marginBottom: 16 }}>⚠ Desconecte para editar todos os campos.</div>}
                                <ConfigPanel config={config} onChange={configChange} connected={connected} />
                            </div>
                        )}

                        {/* ── Logs ── */}
                        {tab === "logs" && (
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                    <SectionTitle>Mensagens OCPP</SectionTitle>
                                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                        {[["#00e5a0","TX"],["#00b4ff","RX"],["#f472b6","CSMS"],["#ef4444","FAULT"],["#ff6060","ERR"]].map(([c,l]) => (
                                            <span key={l} style={{ fontSize: 9, color: c, fontFamily: "monospace" }}>■ {l}</span>
                                        ))}
                                        <button onClick={() => setLogs([])} style={{ background: "none", border: "1px solid #1e2a3a", borderRadius: 4, color: "#3a5a7a", padding: "4px 8px", fontSize: 9, cursor: "pointer", fontFamily: "monospace", marginLeft: 4 }}>Limpar</button>
                                    </div>
                                </div>
                                <LogPanel logs={logs} />

                                <div style={{ marginTop: 16 }}>
                                    <SectionTitle>Enviar Manual</SectionTitle>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                                        {["Heartbeat", "StatusNotification"].map(a => (
                                            <button key={a} disabled={!connected} onClick={() => {
                                                if (a === "Heartbeat") sendOCPP("Heartbeat", {});
                                                if (a === "StatusNotification") { const e = evses.find(x => x.id === selectedEvse); sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: e?.status || "Available", evseId: selectedEvse, connectorId: 1 }, selectedEvse); }
                                            }} style={{ ...btnStyle("#1e3a5a", !connected), width: "auto", padding: "8px 12px", fontSize: 10 }}>{a}</button>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginTop: 16 }}>
                                    <SectionTitle>Payloads de Referência</SectionTitle>
                                    <div style={{ background: "#070c14", border: "1px solid #1a2535", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 10, color: "#4a7a9a", lineHeight: 1.8 }}>
                                        {[
                                            { label: "Iniciar carga (EVSE 1)", payload: `[2,"ID","RequestStartTransaction",\n{"evseId":1,"remoteStartId":1,\n "idToken":{"idToken":"USER001","type":"Central"}}]` },
                                            { label: "Parar carga", payload: `[2,"ID","RequestStopTransaction",\n{"transactionId":"TX_ID"}]` },
                                            { label: "Inativar EVSE 2", payload: `[2,"ID","ChangeAvailability",\n{"evseId":2,"operationalStatus":"Inoperative"}]` },
                                        ].map(({ label, payload }) => (
                                            <div key={label} style={{ marginBottom: 12 }}>
                                                <div style={{ color: "#f472b6", marginBottom: 2 }}>// {label}</div>
                                                <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#4a6a8a" }}>{payload}</pre>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
