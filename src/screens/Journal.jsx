import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Star, Check, Lightbulb, Rocket, BookOpenCheck } from "lucide-react";
import { getJournal, saveJournal } from "../lib/db";
import { Card, Button, Spinner } from "../components/ui";
import { listContainer, listItem, ease } from "../theme";

const FIELDS = [
  { key: "learnings", label: "What I learnt", Icon: BookOpenCheck, placeholder: "The big ideas that stuck with you…" },
  { key: "takeaways", label: "Key takeaways", Icon: Lightbulb, placeholder: "The points worth remembering…" },
  { key: "action_steps", label: "Actionable steps", Icon: Rocket, placeholder: "What will you actually do differently?" },
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
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.28, ease }}
      style={{ minHeight: "100vh", background: "var(--bg)", position: "relative", zIndex: 1 }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px 60px" }}>
        <Button variant="ghost" size="sm" onClick={onBack} style={{ marginBottom: 22 }}><ChevronLeft size={16} /> Back</Button>

        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 6 }}>Reading journal</p>
        <h1 style={{ fontSize: "clamp(1.5rem, 5vw, 2rem)", lineHeight: 1.2 }}>{book.title}</h1>
        {book.author && <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 6 }}>{book.author}</p>}

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}><Spinner /></div>
        ) : (
          <motion.div variants={listContainer} initial="hidden" animate="show" style={{ marginTop: 22 }}>
            {/* Rating */}
            <motion.div variants={listItem}>
              <Card style={{ marginBottom: 12, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Rating</p>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const on = n <= form.rating;
                    return (
                      <motion.button key={n} whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.15 }} onClick={() => update("rating", n === form.rating ? 0 : n)}
                        style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}>
                        <Star size={28} color={on ? "var(--brand)" : "var(--text-3)"} fill={on ? "var(--brand)" : "none"} />
                      </motion.button>
                    );
                  })}
                </div>
              </Card>
            </motion.div>

            {FIELDS.map(f => (
              <motion.div key={f.key} variants={listItem}>
                <Card style={{ marginBottom: 12, padding: 16 }}>
                  <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                    <f.Icon size={14} /> {f.label}
                  </p>
                  <textarea
                    className="field"
                    value={form[f.key]}
                    onChange={e => update(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={4}
                    style={{ lineHeight: 1.55, resize: "vertical" }}
                  />
                </Card>
              </motion.div>
            ))}

            {error && <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "10px 14px", marginBottom: 12 }}><p style={{ fontSize: 12, color: "var(--error)" }}>{error}</p></div>}

            <Button variant={saved ? "success" : "primary"} full size="lg" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size={16} /> : saved ? <><Check size={16} /> Saved</> : "Save journal"}
            </Button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
