import { useState, useEffect } from "react";
import { fetchStats } from "../lib/db";
import { periodRange, summarize, formatDuration, PERIODS } from "../lib/analytics";

function TopList({ title, rows, unit }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#c8a96e", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 10 }}>{title}</p>
      {rows.length === 0 ? (
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#444" }}>No listening data yet</p>
      ) : (
        rows.slice(0, 5).map((r, i) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: i < Math.min(rows.length, 5) - 1 ? "0.5px solid #1e1e1e" : "none" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#c8a96e", width: 16 }}>{i + 1}</span>
              <span style={{ color: "#e8e0d0", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
            </span>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#666", flexShrink: 0, marginLeft: 10 }}>{unit(r)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export default function Wrapped() {
  const [period, setPeriod] = useState("month");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      const { from, to } = periodRange(period);
      const { data, error } = await fetchStats(from, to);
      if (!active) return;
      if (error) setError(error.message);
      setStats(summarize(data || { completions: [], sessions: [] }));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [period]);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 1rem", position: "relative", zIndex: 1 }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.2em", color: "#c8a96e", textTransform: "uppercase", marginBottom: 6 }}>Your Wrapped</p>
        <h2 style={{ fontSize: "clamp(1.4rem, 5vw, 2rem)", fontWeight: 300, color: "#e8e0d0", lineHeight: 1.2 }}>Listening stats</h2>
      </div>

      {/* Period tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {PERIODS.map(p => (
          <button key={p.key} className={`speed-btn ${period === p.key ? "active" : ""}`} onClick={() => setPeriod(p.key)} style={{ fontSize: 11, padding: "6px 12px" }}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ width: 24, height: 24, border: "2px solid #c8a96e", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div className="card" style={{ textAlign: "center" }}>
              <p style={{ fontSize: 34, fontWeight: 300, color: "#c8a96e", lineHeight: 1 }}>{stats.booksFinished}</p>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Books finished</p>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <p style={{ fontSize: 34, fontWeight: 300, color: "#c8a96e", lineHeight: 1 }}>{formatDuration(stats.totalSeconds)}</p>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Time listened</p>
            </div>
          </div>

          <TopList title="Most listened authors" rows={stats.topAuthors} unit={r => formatDuration(r.seconds)} />
          <TopList title="Most listened categories" rows={stats.topCategories} unit={r => formatDuration(r.seconds)} />
          <TopList title="Top books" rows={stats.topBooks} unit={r => formatDuration(r.seconds)} />

          {error && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px" }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ {error}</p></div>}
        </>
      )}
    </div>
  );
}
