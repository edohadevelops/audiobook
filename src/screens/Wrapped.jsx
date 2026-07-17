import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BookCheck, Clock, Users, Tags, TrendingUp } from "lucide-react";
import { fetchStats } from "../lib/db";
import { periodRange, summarize, formatDuration, PERIODS } from "../lib/analytics";
import { Card, Spinner } from "../components/ui";
import { listContainer, listItem, ease, spring } from "../theme";

function TopList({ title, Icon, rows, unit }) {
  return (
    <Card style={{ marginBottom: 12, padding: 18 }}>
      <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
        <Icon size={14} color="var(--brand)" /> {title}
      </p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--text-3)" }}>No listening data yet</p>
      ) : (
        rows.slice(0, 5).map((r, i) => {
          const max = rows[0].seconds || 1;
          return (
            <div key={r.name} style={{ padding: "7px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--brand)", width: 14 }}>{i + 1}</span>
                  <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0, marginLeft: 10 }}>{unit(r)}</span>
              </div>
              <div style={{ height: 4, background: "var(--surface-hi)", borderRadius: 4, overflow: "hidden" }}>
                <motion.div initial={{ width: 0 }} animate={{ width: `${(r.seconds / max) * 100}%` }} transition={{ ...spring, delay: 0.05 * i }}
                  style={{ height: "100%", background: "var(--brand)", borderRadius: 4 }} />
              </div>
            </div>
          );
        })
      )}
    </Card>
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
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "8px 16px 120px", position: "relative", zIndex: 1 }}>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}
        className="grad-text" style={{ fontSize: "clamp(2rem, 7vw, 2.6rem)", marginBottom: 2 }}>
        Your Wrapped
      </motion.h1>
      <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 20 }}>Listening stats</p>

      {/* Period tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {PERIODS.map(p => {
          const active = period === p.key;
          return (
            <motion.button key={p.key} whileTap={{ scale: 0.94 }} onClick={() => setPeriod(p.key)}
              style={{ border: "1px solid " + (active ? "var(--brand)" : "var(--border)"), background: active ? "var(--brand)" : "transparent", color: active ? "var(--brand-contrast)" : "var(--text-2)", borderRadius: "var(--r-full)", padding: "7px 15px", fontSize: 12.5, fontWeight: active ? 700 : 500, cursor: "pointer" }}>
              {p.label}
            </motion.button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spinner /></div>
      ) : (
        <motion.div variants={listContainer} initial="hidden" animate="show" key={period}>
          {/* Hero stat panels */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <motion.div variants={listItem} style={{ borderRadius: "var(--r-lg)", padding: 20, background: "linear-gradient(150deg, var(--brand), #12833a)", color: "#04120a", boxShadow: "var(--shadow)" }}>
              <BookCheck size={20} style={{ opacity: 0.85 }} />
              <p style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 12 }}>{stats.booksFinished}</p>
              <p style={{ fontSize: 11, fontWeight: 700, marginTop: 6, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.8 }}>Books finished</p>
            </motion.div>
            <motion.div variants={listItem} style={{ borderRadius: "var(--r-lg)", padding: 20, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
              <Clock size={20} color="var(--brand)" />
              <p style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, marginTop: 12, color: "var(--text)" }}>{formatDuration(stats.totalSeconds)}</p>
              <p style={{ fontSize: 11, fontWeight: 700, marginTop: 6, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)" }}>Time listened</p>
            </motion.div>
          </div>

          <motion.div variants={listItem}><TopList title="Most listened authors" Icon={Users} rows={stats.topAuthors} unit={r => formatDuration(r.seconds)} /></motion.div>
          <motion.div variants={listItem}><TopList title="Most listened categories" Icon={Tags} rows={stats.topCategories} unit={r => formatDuration(r.seconds)} /></motion.div>
          <motion.div variants={listItem}><TopList title="Top books" Icon={TrendingUp} rows={stats.topBooks} unit={r => formatDuration(r.seconds)} /></motion.div>

          {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "10px 14px" }}><p style={{ fontSize: 12, color: "var(--error)" }}>{error}</p></div>}
        </motion.div>
      )}
    </div>
  );
}
