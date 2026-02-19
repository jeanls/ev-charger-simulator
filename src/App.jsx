import { useState, useEffect, useRef, useCallback } from "react";

const OCPP_MSG = { CALL: 2, CALLRESULT: 3, CALLERROR: 4 };

const STATUS = {
    Available: "Available", Preparing: "Preparing", Charging: "Charging",
    SuspendedEVSE: "SuspendedEVSE", SuspendedEV: "SuspendedEV",
    Finishing: "Finishing", Reserved: "Reserved", Unavailable: "Unavailable", Faulted: "Faulted",
};

const STATUS_COLOR = {
    Available: "#00e5a0", Preparing: "#f0c040", Charging: "#00b4ff",
    SuspendedEVSE: "#ff9800", SuspendedEV: "#ff9800", Finishing: "#a78bfa",
    Reserved: "#f472b6", Unavailable: "#6b7280", Faulted: "#ef4444",
};

function uid() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function now() { return new Date().toISOString(); }

function LogPanel({ logs }) {
    const ref = useRef();
    useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);
    return (
        <div ref={ref} style={{ background: "#0a0e1a", border: "1px solid #1e2a3a", borderRadius: 8, height: 220, overflowY: "auto", padding: "10px 14px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7 }}>
            {logs.length === 0 && <span style={{ color: "#3a4a5a" }}>Aguardando mensagens OCPP...</span>}
            {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                    <span style={{ color: "#3a5a7a" }}>{log.time} </span>
                    <span style={{ color: log.dir === "TX" ? "#00e5a0" : log.dir === "RX" ? "#00b4ff" : log.dir === "ERR" ? "#ef4444" : "#a0a0b0" }}>[{log.dir}]</span>{" "}
                    <span style={{ color: "#c0cce0" }}>{log.msg}</span>
                </div>
            ))}
        </div>
    );
}

function Gauge({ value, max, label, unit, color }) {
    const r = 44, circ = 2 * Math.PI * r;
    const dash = Math.min(value / max, 1) * circ * 0.75;
    const offset = circ * 0.125;
    return (
        <div style={{ textAlign: "center" }}>
            <svg width={110} height={110} viewBox="0 0 110 110">
                <circle cx={55} cy={55} r={r} fill="none" stroke="#1a2535" strokeWidth={10} strokeDasharray={`${circ * 0.75} ${circ}`} strokeDashoffset={-offset} strokeLinecap="round" />
                <circle cx={55} cy={55} r={r} fill="none" stroke={color} strokeWidth={10} strokeDasharray={`${dash} ${circ}`} strokeDashoffset={-offset} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }} />
                <text x={55} y={52} textAnchor="middle" fill="#e0eaf8" fontSize={18} fontWeight="700" fontFamily="monospace">{value.toFixed(1)}</text>
                <text x={55} y={67} textAnchor="middle" fill="#5a7a9a" fontSize={10} fontFamily="monospace">{unit}</text>
            </svg>
            <div style={{ marginTop: -6, fontSize: 11, color: "#6a8aaa", fontFamily: "monospace", letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
        </div>
    );
}

function ChargerBody({ status, connectorType, power, energy, soc, sessionTime }) {
    const color = STATUS_COLOR[status] || "#6b7280";
    const isCharging = status === STATUS.Charging;
    return (
        <div style={{ position: "relative", width: 220, margin: "0 auto", userSelect: "none" }}>
            <div style={{ background: "linear-gradient(160deg, #111827 60%, #1a2535)", border: `2px solid ${color}33`, borderRadius: 20, padding: "28px 20px 24px", boxShadow: `0 0 40px ${color}22, 0 20px 60px #00000088, inset 0 1px 0 #ffffff0a`, position: "relative", overflow: "hidden" }}>
                {isCharging && <div style={{ position: "absolute", top: 0, left: "-100%", width: "60%", height: "100%", background: `linear-gradient(90deg, transparent, ${color}15, transparent)`, animation: "sweep 2.5s infinite" }} />}
                <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 800, fontSize: 13, letterSpacing: 4, color: "#2a3a50", marginBottom: 16 }}>VOLTCORE</div>
                <div style={{ background: "#070c14", borderRadius: 12, padding: "16px 12px", border: `1px solid ${color}44`, boxShadow: `inset 0 0 20px #000000aa`, marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, animation: isCharging ? "pulse 1.2s infinite" : "none" }} />
                        <span style={{ fontFamily: "monospace", fontSize: 11, color, letterSpacing: 2, fontWeight: 700 }}>{status.toUpperCase()}</span>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 10, color: "#4a6a8a", marginBottom: 4 }}>
                            <span>SOC</span><span style={{ color: "#00e5a0" }}>{soc.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 6, background: "#1a2535", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${soc}%`, background: "linear-gradient(90deg, #00e5a0, #00b4ff)", borderRadius: 4, transition: "width 1s ease", boxShadow: "0 0 8px #00e5a060" }} />
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 11, color: "#4a6a8a" }}>
                        <div><div style={{ fontSize: 16, color: "#00b4ff", fontWeight: 700 }}>{energy.toFixed(2)}</div><div style={{ fontSize: 9, letterSpacing: 1 }}>kWh</div></div>
                        <div style={{ textAlign: "center" }}><div style={{ fontSize: 16, color: "#f0c040", fontWeight: 700 }}>{power.toFixed(1)}</div><div style={{ fontSize: 9, letterSpacing: 1 }}>kW</div></div>
                        <div style={{ textAlign: "right" }}><div style={{ fontSize: 16, color: "#a78bfa", fontWeight: 700 }}>{sessionTime}</div><div style={{ fontSize: 9, letterSpacing: 1 }}>HH:MM</div></div>
                    </div>
                </div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#3a5a7a", letterSpacing: 2, marginBottom: 14 }}>{connectorType}</div>
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                    <div style={{ display: "inline-block", width: 48, height: 48, borderRadius: "50%", background: "#0d1520", border: `3px solid ${color}66`, boxShadow: `0 0 16px ${color}44, inset 0 0 12px #000`, position: "relative" }}>
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
                    </div>
                </div>
                <div style={{ textAlign: "center", fontFamily: "monospace", fontSize: 9, color: "#1e3050", letterSpacing: 2 }}>OCPP 2.0.1</div>
            </div>
        </div>
    );
}

const inputStyle = (disabled) => ({
    width: "100%", background: disabled ? "#0a0f1a" : "#0d1520", border: "1px solid #1e2a3a",
    borderRadius: 6, color: disabled ? "#3a5a7a" : "#c0cce0", padding: "7px 10px",
    fontFamily: "monospace", fontSize: 12, outline: "none", boxSizing: "border-box", cursor: disabled ? "not-allowed" : "text",
});

function ConfigPanel({ config, onChange, connected }) {
    const field = (label, key, type = "text", opts = {}) => (
        <div style={{ marginBottom: 12 }} key={key}>
            <label style={{ display: "block", fontFamily: "monospace", fontSize: 10, color: "#4a6a8a", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>{label}</label>
            {opts.select ? (
                <select value={config[key]} onChange={(e) => onChange(key, e.target.value)} disabled={connected} style={{ ...inputStyle(connected), display: "block" }}>
                    {opts.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : (
                <input type={type} value={config[key]} onChange={(e) => onChange(key, type === "number" ? +e.target.value : e.target.value)}
                       disabled={connected} style={inputStyle(connected)} min={opts.min} max={opts.max} />
            )}
        </div>
    );
    return (
        <div>
            {field("CSMS URL (WebSocket)", "csmsUrl")}
            {field("Station ID", "stationId")}
            {field("Fabricante", "vendor")}
            {field("Modelo", "model")}
            {field("Número de Série", "serialNumber")}
            {field("Potência Máx (kW)", "maxPower", "number", { min: 1, max: 350 })}
            {field("Tipo de Conector", "connectorType", "text", { select: true, options: ["CCS2", "CHAdeMO", "Type2", "Tesla", "GB/T"] })}
            {field("Heartbeat Interval (s)", "heartbeatInterval", "number", { min: 10, max: 300 })}
            {field("Voltagem (V)", "voltage", "number", { min: 100, max: 1000 })}
        </div>
    );
}

function SectionTitle({ children, style: s }) {
    return <div style={{ fontSize: 9, letterSpacing: 2, color: "#2a4a6a", textTransform: "uppercase", borderBottom: "1px solid #1a2535", paddingBottom: 6, marginBottom: 10, ...s }}>{children}</div>;
}

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

export default function App() {
    const [config, setConfig] = useState({
        csmsUrl: "ws://localhost:9000/ocpp", stationId: "EVCS-001",
        vendor: "VoltCore Systems", model: "VC-150DC", serialNumber: "VC2024000001",
        maxPower: 50, connectorType: "CCS2", heartbeatInterval: 30, voltage: 400,
    });
    const [status, setStatus] = useState(STATUS.Available);
    const [connected, setConnected] = useState(false);
    const [simMode, setSimMode] = useState(false);
    const [logs, setLogs] = useState([]);
    const [tab, setTab] = useState("monitor");
    const [session, setSession] = useState(null);
    const [power, setPower] = useState(0);
    const [idTagInput, setIdTagInput] = useState("USER001");
    const [tick, setTick] = useState(0);
    const wsRef = useRef(null);
    const heartbeatRef = useRef(null);
    const meterRef = useRef(null);
    const sessionRef = useRef(null);
    const configRef = useRef(config);
    configRef.current = config;

    useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); }, []);
    useEffect(() => () => { clearInterval(heartbeatRef.current); clearInterval(meterRef.current); }, []);

    const addLog = useCallback((dir, msg) => {
        const time = new Date().toLocaleTimeString("pt-BR");
        setLogs(prev => [...prev.slice(-200), { dir, msg, time }]);
    }, []);

    const simulateCsmsResponse = useCallback((action, payload) => {
        let response = {};
        if (action === "BootNotification") response = { currentTime: now(), interval: configRef.current.heartbeatInterval, status: "Accepted" };
        else if (action === "Heartbeat") response = { currentTime: now() };
        else if (action === "Authorize") response = { idTokenInfo: { status: "Accepted" } };
        else if (action === "TransactionEvent") response = { idTokenInfo: { status: "Accepted" } };
        addLog("RX", `${action}Response ← ${JSON.stringify(response).slice(0, 120)}`);
    }, [addLog]);

    const sendOCPP = useCallback((action, payload) => {
        addLog("TX", `${action} → ${JSON.stringify(payload).slice(0, 120)}`);
        if (simMode || !wsRef.current) {
            setTimeout(() => simulateCsmsResponse(action, payload), 350);
        } else if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify([OCPP_MSG.CALL, uid(), action, payload]));
        }
    }, [simMode, addLog, simulateCsmsResponse]);

    const sendBoot = useCallback(() => {
        sendOCPP("BootNotification", { reason: "PowerUp", chargingStation: { serialNumber: configRef.current.serialNumber, model: configRef.current.model, vendorName: configRef.current.vendor, firmwareVersion: "2.1.4" } });
        sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId: 1, connectorId: 1 });
    }, [sendOCPP]);

    const startHeartbeat = useCallback(() => {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => sendOCPP("Heartbeat", {}), configRef.current.heartbeatInterval * 1000);
    }, [sendOCPP]);

    const connect = useCallback((sim) => {
        if (sim) {
            addLog("SYS", "[SIM] Conectado ao CSMS simulado");
            setConnected(true); setSimMode(true); setStatus(STATUS.Available);
            setTimeout(sendBoot, 300); startHeartbeat();
            return;
        }
        try {
            const ws = new WebSocket(configRef.current.csmsUrl, ["ocpp2.0.1"]);
            wsRef.current = ws;
            ws.onopen = () => { addLog("SYS", `Conectado a ${configRef.current.csmsUrl}`); setConnected(true); setStatus(STATUS.Available); setTimeout(sendBoot, 300); startHeartbeat(); };
            ws.onmessage = (e) => { try { const [type, msgId, payload] = JSON.parse(e.data); addLog("RX", `Msg[${type}] ← ${JSON.stringify(payload).slice(0, 100)}`); } catch { addLog("ERR", "Erro ao parsear mensagem"); } };
            ws.onerror = () => addLog("ERR", "Erro de WebSocket");
            ws.onclose = () => { addLog("SYS", "Conexão encerrada"); setConnected(false); clearInterval(heartbeatRef.current); };
        } catch (e) { addLog("ERR", `Falha: ${e.message}`); }
    }, [addLog, sendBoot, startHeartbeat]);

    const stopSession = useCallback(() => {
        clearInterval(meterRef.current);
        const ses = sessionRef.current;
        if (!ses) return;
        setStatus(STATUS.Finishing);
        addLog("SYS", `Sessão encerrada | energia=${ses.energy.toFixed(3)} kWh`);
        sendOCPP("TransactionEvent", { eventType: "Ended", timestamp: now(), triggerReason: "StopAuthorized", seqNo: 99, transactionInfo: { transactionId: ses.transactionId, chargingState: "Idle", stoppedReason: "Local" }, meterValue: [{ timestamp: now(), sampledValue: [{ value: Math.round(ses.energy * 1000), measurand: "Energy.Active.Import.Register", unit: "Wh" }] }] });
        setTimeout(() => { setSession(null); sessionRef.current = null; setPower(0); setStatus(STATUS.Available); sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: "Available", evseId: 1, connectorId: 1 }); }, 2000);
    }, [addLog, sendOCPP]);

    const disconnect = useCallback(() => {
        clearInterval(heartbeatRef.current); clearInterval(meterRef.current);
        stopSession();
        if (wsRef.current) wsRef.current.close();
        setConnected(false); setSimMode(false); setStatus(STATUS.Unavailable);
        addLog("SYS", "Desconectado");
    }, [stopSession, addLog]);

    const startSession = useCallback(() => {
        if (!connected) return;
        const txId = uid();
        const ses = { startTime: Date.now(), energy: 0, soc: 20, transactionId: txId, idTag: idTagInput };
        setSession(ses); sessionRef.current = ses;
        setStatus(STATUS.Preparing);
        addLog("SYS", `Sessão iniciada | txId=${txId} | idTag=${idTagInput}`);
        sendOCPP("Authorize", { idToken: { idToken: idTagInput, type: "ISO14443" } });
        setTimeout(() => {
            setStatus(STATUS.Charging);
            sendOCPP("TransactionEvent", { eventType: "Started", timestamp: now(), triggerReason: "Authorized", seqNo: 0, transactionInfo: { transactionId: txId, chargingState: "Charging" }, idToken: { idToken: idTagInput, type: "ISO14443" }, evse: { id: 1, connectorId: 1 } });
            meterRef.current = setInterval(() => {
                const p = configRef.current.maxPower * (0.7 + Math.random() * 0.3);
                const e = p / 3600;
                setPower(p);
                setSession(prev => { if (!prev) return prev; const n = { ...prev, energy: prev.energy + e, soc: Math.min(100, prev.soc + e * 2) }; sessionRef.current = n; return n; });
            }, 1000);
        }, 1500);
    }, [connected, idTagInput, addLog, sendOCPP]);

    const sessionElapsed = () => {
        if (!session) return "00:00";
        const s = Math.floor((Date.now() - session.startTime) / 1000);
        return `${Math.floor(s / 3600).toString().padStart(2, "0")}:${Math.floor((s % 3600) / 60).toString().padStart(2, "0")}`;
    };

    const color = STATUS_COLOR[status] || "#6b7280";
    const configChange = (k, v) => setConfig(c => ({ ...c, [k]: v }));

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
            <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 20% 50%, #0a1525 0%, #060a12 60%)", color: "#c0cce0", fontFamily: "'JetBrains Mono', monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 16px" }}>
                {/* Header */}
                <div style={{ textAlign: "center", marginBottom: 32 }}>
                    <div style={{ fontSize: 11, letterSpacing: 6, color: "#2a4a6a", marginBottom: 6, textTransform: "uppercase" }}>Simulador OCPP 2.0.1</div>
                    <div style={{ fontSize: 26, fontWeight: 800, background: "linear-gradient(90deg, #00e5a0, #00b4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: 2 }}>EV Charging Station</div>
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 11 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00e5a0" : "#ef4444", boxShadow: connected ? "0 0 6px #00e5a0" : "0 0 6px #ef4444", animation: connected ? "pulse 2s infinite" : "none" }} />
                        <span style={{ color: connected ? "#00e5a0" : "#ef4444" }}>{connected ? "Online" : "Offline"}</span>
                        <span style={{ color: "#2a3a50" }}>|</span>
                        <span style={{ color: "#3a5a7a" }}>{config.stationId}</span>
                        {simMode && <><span style={{ color: "#2a3a50" }}>|</span><span style={{ color: "#f0c040", fontSize: 10 }}>⚙ MODO SIM</span></>}
                    </div>
                </div>

                {/* Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 24, maxWidth: 900, width: "100%" }}>
                    {/* Left */}
                    <div>
                        <ChargerBody status={status} connectorType={config.connectorType} power={power} energy={session?.energy ?? 0} soc={session?.soc ?? 0} sessionTime={sessionElapsed()} />
                        <div style={{ display: "flex", justifyContent: "space-around", marginTop: 16, background: "#080d18", borderRadius: 12, padding: "12px 4px", border: "1px solid #1a2535" }}>
                            <Gauge value={power} max={config.maxPower} label="Potência" unit="kW" color="#00b4ff" />
                            <Gauge value={session?.soc ?? 0} max={100} label="SOC" unit="%" color="#00e5a0" />
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <label style={{ fontSize: 9, color: "#3a5a7a", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 4 }}>ID Tag (RFID / App)</label>
                            <input value={idTagInput} onChange={(e) => setIdTagInput(e.target.value)} style={inputStyle(false)} placeholder="USER001" />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                            {!connected ? (
                                <>
                                    <button onClick={() => connect(false)} style={btnStyle("#00e5a0")}>⚡ Conectar (WS Real)</button>
                                    <button onClick={() => connect(true)} style={btnStyle("#f0c040")}>⚙ Modo Simulado</button>
                                </>
                            ) : (
                                <>
                                    {status === STATUS.Available && <button onClick={startSession} style={btnStyle("#00b4ff")}>▶ Iniciar Sessão</button>}
                                    {(status === STATUS.Charging || status === STATUS.Preparing) && <button onClick={stopSession} style={btnStyle("#ef4444")}>■ Parar Sessão</button>}
                                    <button onClick={disconnect} style={btnStyle("#6b7280")}>✕ Desconectar</button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Right */}
                    <div>
                        <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
                            {["monitor", "config", "logs"].map(t => (
                                <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 18px", background: tab === t ? "#0d1520" : "transparent", border: `1px solid ${tab === t ? "#1e3a5a" : "#1a2535"}`, borderRadius: 6, color: tab === t ? "#00b4ff" : "#3a5a7a", fontFamily: "monospace", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}>{t}</button>
                            ))}
                        </div>

                        {tab === "monitor" && (
                            <div>
                                <SectionTitle>Estado da Estação</SectionTitle>
                                <InfoGrid items={[
                                    { label: "Status", value: status, color },
                                    { label: "Potência Atual", value: `${power.toFixed(2)} kW` },
                                    { label: "Potência Máx", value: `${config.maxPower} kW` },
                                    { label: "Voltagem", value: `${config.voltage} V` },
                                    { label: "Corrente", value: power > 0 ? `${((power * 1000) / config.voltage).toFixed(1)} A` : "0 A" },
                                    { label: "Conector", value: config.connectorType },
                                ]} />
                                {session && <>
                                    <SectionTitle style={{ marginTop: 20 }}>Sessão Ativa</SectionTitle>
                                    <InfoGrid items={[
                                        { label: "Transaction ID", value: session.transactionId },
                                        { label: "ID Tag", value: session.idTag },
                                        { label: "Energia", value: `${session.energy.toFixed(3)} kWh` },
                                        { label: "SOC", value: `${session.soc.toFixed(1)}%` },
                                        { label: "Duração", value: sessionElapsed() },
                                        { label: "Custo Est.", value: `R$ ${(session.energy * 1.5).toFixed(2)}` },
                                    ]} />
                                </>}
                                <SectionTitle style={{ marginTop: 20 }}>Informações OCPP</SectionTitle>
                                <InfoGrid items={[
                                    { label: "Protocolo", value: "OCPP 2.0.1" },
                                    { label: "Vendor", value: config.vendor },
                                    { label: "Modelo", value: config.model },
                                    { label: "Serial", value: config.serialNumber },
                                    { label: "Heartbeat", value: `${config.heartbeatInterval}s` },
                                    { label: "CSMS", value: simMode ? "Simulado" : config.csmsUrl },
                                ]} />
                            </div>
                        )}

                        {tab === "config" && (
                            <div style={{ background: "#080d18", border: "1px solid #1a2535", borderRadius: 10, padding: 20 }}>
                                {connected && <div style={{ background: "#1a1500", border: "1px solid #3a2a00", borderRadius: 6, padding: "8px 12px", fontSize: 10, color: "#f0c040", marginBottom: 16 }}>⚠ Desconecte para editar todos os campos.</div>}
                                <ConfigPanel config={config} onChange={configChange} connected={connected} />
                            </div>
                        )}

                        {tab === "logs" && (
                            <div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                    <SectionTitle>Mensagens OCPP</SectionTitle>
                                    <button onClick={() => setLogs([])} style={{ background: "none", border: "1px solid #1e2a3a", borderRadius: 4, color: "#3a5a7a", padding: "4px 10px", fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>Limpar</button>
                                </div>
                                <LogPanel logs={logs} />
                                <div style={{ marginTop: 16 }}>
                                    <SectionTitle>Enviar Manual</SectionTitle>
                                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                        {["Heartbeat", "StatusNotification"].map(a => (
                                            <button key={a} disabled={!connected} onClick={() => {
                                                if (a === "Heartbeat") sendOCPP("Heartbeat", {});
                                                if (a === "StatusNotification") sendOCPP("StatusNotification", { timestamp: now(), connectorStatus: status, evseId: 1, connectorId: 1 });
                                            }} style={{ ...btnStyle("#1e3a5a", !connected), width: "auto", padding: "8px 14px" }}>{a}</button>
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