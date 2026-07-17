import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Trophy, Check, Pencil, TrendingUp } from "lucide-react";
import { getGoal, setGoal, countCompletionsInYear } from "../lib/db";
import { Card, Button, Spinner } from "../components/ui";
import { ease } from "../theme";

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
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(year, 0, 0)) / 86400000);
  const expected = Math.round((dayOfYear / 365) * target);
  const onTrack = finished >= expected;
  const reached = finished >= target;

  const R = 70, C = 2 * Math.PI * R;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "8px 16px 120px", position: "relative", zIndex: 1 }}>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}
        className="grad-text" style={{ fontSize: "clamp(2rem, 7vw, 2.6rem)", marginBottom: 2 }}>
        Reading Goal
      </motion.h1>
      <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 24 }}>{year}</p>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spinner /></div>
      ) : (
        <>
          <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 12 }}>
            <div style={{ position: "relative", width: 180, height: 180 }}>
              <svg width="180" height="180" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="90" cy="90" r={R} fill="none" stroke="var(--surface-hi)" strokeWidth="12" />
                <motion.circle cx="90" cy="90" r={R} fill="none" stroke={reached ? "var(--success)" : "var(--brand)"} strokeWidth="12" strokeLinecap="round"
                  strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C - (pct / 100) * C }}
                  transition={{ duration: 1, ease }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 18 }}
                  style={{ fontSize: 48, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>{finished}</motion.span>
                <span style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>of {target}</span>
              </div>
            </div>

            <div style={{ marginTop: 18, textAlign: "center" }}>
              {reached ? (
                <p style={{ color: "var(--success)", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <Trophy size={18} /> Goal reached — {finished} books this year!
                </p>
              ) : (
                <>
                  <p style={{ color: "var(--text)", fontSize: 16, fontWeight: 600 }}>{remaining} book{remaining === 1 ? "" : "s"} to go</p>
                  <p style={{ fontSize: 12.5, color: onTrack ? "var(--success)" : "var(--brand)", marginTop: 6, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                    {onTrack ? <><Check size={14} /> On track</> : <><TrendingUp size={14} /> Behind pace — ~{expected} expected by now</>}
                  </p>
                </>
              )}
            </div>
          </Card>

          <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>Books per year</span>
            {editing ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input className="field" type="number" min="1" value={draft} onChange={e => setDraft(e.target.value)} style={{ width: 72, padding: "8px 10px" }} />
                <Button variant="primary" size="sm" onClick={saveTarget}><Check size={14} /> Save</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil size={13} /> Edit ({target})</Button>
            )}
          </Card>

          {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "10px 14px", marginTop: 12 }}><p style={{ fontSize: 12, color: "var(--error)" }}>{error}</p></div>}
        </>
      )}
    </div>
  );
}
