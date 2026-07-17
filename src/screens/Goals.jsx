import { useState, useEffect } from "react";
import { getGoal, setGoal, countCompletionsInYear } from "../lib/db";

export default function Goals() {
  const year = new Date().getFullYear();
  const [target, setTarget] = useState(12);
  const [finished, setFinished] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("12");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const [goalRes, countRes] = await Promise.all([getGoal(year), countCompletionsInYear(year)]);
    if (goalRes.error || countRes.error) setError((goalRes.error || countRes.error).message);
    const t = goalRes.data?.target ?? 12;
    setTarget(t);
    setDraft(String(t));
    setFinished(countRes.data?.count ?? 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveTarget = async () => {
    const n = Math.max(1, parseInt(draft, 10) || 12);
    const { error } = await setGoal(year, n);
    if (error) { setError(error.message); return; }
    setTarget(n);
    setEditing(false);
  };

  const pct = target ? Math.min(100, Math.round((finished / target) * 100)) : 0;
  const remaining = Math.max(0, target - finished);

  // Pace: how many "should" be done by now if spread evenly across the year.
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 86400000);
  const expected = Math.round((dayOfYear / 365) * target);
  const onTrack = finished >= expected;

  // Ring geometry
  const R = 70, C = 2 * Math.PI * R;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 1rem", position: "relative", zIndex: 1 }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.2em", color: "#c8a96e", textTransform: "uppercase", marginBottom: 6 }}>Reading goal</p>
        <h2 style={{ fontSize: "clamp(1.4rem, 5vw, 2rem)", fontWeight: 300, color: "#e8e0d0", lineHeight: 1.2 }}>{year}</h2>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ width: 24, height: 24, border: "2px solid #c8a96e", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 12 }}>
            <div style={{ position: "relative", width: 180, height: 180 }}>
              <svg width="180" height="180" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="90" cy="90" r={R} fill="none" stroke="#1e1e1e" strokeWidth="10" />
                <circle cx="90" cy="90" r={R} fill="none" stroke="#c8a96e" strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={C} strokeDashoffset={C - (pct / 100) * C} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 42, fontWeight: 300, color: "#e8e0d0", lineHeight: 1 }}>{finished}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#555", marginTop: 4 }}>of {target}</span>
              </div>
            </div>

            <div style={{ marginTop: 16, textAlign: "center" }}>
              {finished >= target ? (
                <p style={{ color: "#4ab464", fontSize: 14 }}>🎉 Goal reached — {finished} books this year!</p>
              ) : (
                <>
                  <p style={{ color: "#e8e0d0", fontSize: 15 }}>{remaining} book{remaining === 1 ? "" : "s"} to go</p>
                  <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: onTrack ? "#4ab464" : "#c8a96e", marginTop: 4 }}>
                    {onTrack ? "✓ On track" : `Behind pace — ~${expected} expected by now`}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#888" }}>Books per year</span>
            {editing ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" min="1" value={draft} onChange={e => setDraft(e.target.value)}
                  style={{ width: 64, background: "#0d0d0d", border: "0.5px solid #c8a96e", borderRadius: 6, color: "#e8e0d0", fontFamily: "'Space Mono', monospace", fontSize: 13, padding: "6px 8px", outline: "none" }} />
                <button className="btn-icon" onClick={saveTarget} style={{ padding: "6px 12px" }}>Save</button>
              </div>
            ) : (
              <button className="btn-ghost" onClick={() => setEditing(true)}>Edit goal ({target})</button>
            )}
          </div>

          {error && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px", marginTop: 12 }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ {error}</p></div>}
        </>
      )}
    </div>
  );
}
