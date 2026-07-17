import { useState, useEffect } from "react";
import { getJournal, saveJournal } from "../lib/db";

const FIELDS = [
  { key: "learnings", label: "What I learnt", placeholder: "The big ideas that stuck with you…" },
  { key: "takeaways", label: "Key takeaways", placeholder: "The points worth remembering…" },
  { key: "action_steps", label: "Actionable steps", placeholder: "What will you actually do differently?" },
];

export default function Journal({ book, onBack }) {
  const [form, setForm] = useState({ learnings: "", takeaways: "", action_steps: "", rating: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await getJournal(book.id);
      if (!active) return;
      if (error) setError(error.message);
      if (data) setForm({
        learnings: data.learnings || "",
        takeaways: data.takeaways || "",
        action_steps: data.action_steps || "",
        rating: data.rating || 0,
      });
      setLoading(false);
    })();
    return () => { active = false; };
  }, [book.id]);

  const update = (key, value) => { setForm(f => ({ ...f, [key]: value })); setSaved(false); };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const { error } = await saveJournal(book.id, form);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem", position: "relative", zIndex: 1 }}>
      <button className="btn-icon" onClick={onBack} style={{ marginBottom: "1.5rem" }}>← Back</button>

      <div style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.2em", color: "#c8a96e", textTransform: "uppercase", marginBottom: 6 }}>Reading journal</p>
        <h2 style={{ fontSize: "clamp(1.2rem, 4vw, 1.6rem)", fontWeight: 300, color: "#e8e0d0", lineHeight: 1.3 }}>{book.title}</h2>
        {book.author && <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", marginTop: 4 }}>{book.author}</p>}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ width: 24, height: 24, border: "2px solid #c8a96e", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto", animation: "spin 0.8s linear infinite" }} />
        </div>
      ) : (
        <>
          {/* Rating */}
          <div className="card" style={{ marginBottom: 12 }}>
            <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>Rating</p>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => update("rating", n === form.rating ? 0 : n)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 26, lineHeight: 1, color: n <= form.rating ? "#c8a96e" : "#333", transition: "color 0.15s" }}>
                  ★
                </button>
              ))}
            </div>
          </div>

          {FIELDS.map(f => (
            <div className="card" key={f.key} style={{ marginBottom: 12 }}>
              <p style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#c8a96e", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>{f.label}</p>
              <textarea
                value={form[f.key]}
                onChange={e => update(f.key, e.target.value)}
                placeholder={f.placeholder}
                rows={4}
                style={{ width: "100%", background: "#0d0d0d", border: "0.5px solid #2a2a2a", borderRadius: 8, color: "#e8e0d0", fontFamily: "'Crimson Pro', Georgia, serif", fontSize: 15, lineHeight: 1.5, padding: "10px 12px", resize: "vertical", outline: "none" }}
                onFocus={e => (e.target.style.borderColor = "#c8a96e")}
                onBlur={e => (e.target.style.borderColor = "#2a2a2a")}
              />
            </div>
          ))}

          {error && <div style={{ background: "rgba(200,60,60,0.08)", border: "0.5px solid rgba(200,60,60,0.25)", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}><p style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#e06060" }}>⚠ {error}</p></div>}

          <button className="btn-icon" onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "12px", justifyContent: "center", borderColor: saved ? "#4ab464" : "#c8a96e", color: saved ? "#4ab464" : "#c8a96e" }}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save journal"}
          </button>
        </>
      )}
    </div>
  );
}
