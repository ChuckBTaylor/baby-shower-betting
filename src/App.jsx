import React, { useState, useEffect } from "react";

// ─── Local Storage Helpers (replaces artifact window.storage) ─────────────────

function _localGet(key: string): { value: string } | null {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? { value: v } : null;
  } catch { return null; }
}

function _localSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}


// ─── Constants ────────────────────────────────────────────────────────────────

const HOST_PIN = "0811";

const CATEGORIES = [
  { id: "birthdate", label: "Birth Date & Time", type: "datetime", parlayNote: "Exact date required (no time)", shortLabel: "Birthdate",  parlayAllowed: true,  parlayDateOnly: true },
  { id: "weight",    label: "Birth Weight",       type: "weight",   parlayNote: "Within 3 oz",                  shortLabel: "Weight",     parlayAllowed: true },
  { id: "length",    label: "Birth Length",       type: "length",   parlayNote: "Within ¼ inch",                shortLabel: "Length",     parlayAllowed: true },
  { id: "eye_birth", label: "Eye Color at Birth", type: "choice",   parlayNote: "Exact match",                  shortLabel: "Eyes (birth)",parlayAllowed: true,
    options: ["Blue","Gray","Brown","Green","Hazel","Dark (hard to tell)"] },
  { id: "eye_6mo",   label: "Eye Color at 6 Months", type: "choice", parlayNote: "Exact match",                shortLabel: "Eyes (6mo)", parlayAllowed: true,
    options: ["Blue","Gray","Brown","Green","Hazel"] },
  { id: "hair_amt",  label: "Hair Amount at Birth",  type: "choice", parlayNote: "Exact match",                shortLabel: "Hair amt",   parlayAllowed: true,
    options: ["None (bald)","A little (wisps)","A lot (full head)"] },
  { id: "hair_color",label: "Hair Color at 1 Year",  type: "choice", parlayNote: "Exact match",               shortLabel: "Hair color", parlayAllowed: true,
    options: ["Blonde","Red","Brown","Black","Still bald / very sparse"] },
  { id: "dow",       label: "Day of the Week Born",  type: "choice", parlayNote: "Standalone only",           shortLabel: "Day of week",parlayAllowed: false,
    options: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"] },
];

const CAT_FEE = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parlayPayout(stake, legs) {
  return stake * Math.pow(2, legs - 1);
}

function fmtMoney(n) {
  return "$" + Number(n).toFixed(2).replace(/\.00$/, "");
}

function fmtValue(catId, val) {
  if (!val) return "—";
  const cat = CATEGORIES.find(c => c.id === catId);
  if (cat.type === "weight") return val.lbs != null ? `${val.lbs} lbs ${val.oz ?? 0} oz` : "—";
  if (cat.type === "length") return val ? `${val}"` : "—";
  if (cat.type === "datetime") {
    if (val.isRange) return `${val.date || "?"} – ${val.dateTo || "?"}`;
    return `${val.date || "?"}${val.time ? " @ " + val.time : ""}`;
  }
  return String(val);
}

function valueComplete(cat, val) {
  if (!val) return false;
  if (cat.type === "choice") return !!val;
  if (cat.type === "number") return val !== "" && val != null;
  if (cat.type === "weight") return val.lbs !== "" && val.oz !== "" && val.lbs != null;
  if (cat.type === "length") return val !== "" && val != null;
  if (cat.type === "datetime") {
    if (val.isRange) return !!val.date && !!val.dateTo;
    return !!val.date;
  }
  return false;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

// Returns true/false for exact-match categories; a numeric "distance" for proximity ones.
// For standalone "closest guess" categories (weight, length, datetime, number, dow),
// returns a numeric distance so the host dashboard can find the winner.

function scoreStandalone(cat, guess, actual) {
  if (!guess || !actual) return null;

  if (cat.type === "choice") {
    return guess === actual ? "win" : "loss";
  }

  if (cat.type === "number") {
    // Closest wins (ties split)
    return Math.abs(Number(guess) - Number(actual));
  }

  if (cat.type === "weight") {
    const guessOz = Number(guess.lbs) * 16 + Number(guess.oz ?? 0);
    const actualOz = Number(actual.lbs) * 16 + Number(actual.oz ?? 0);
    return Math.abs(guessOz - actualOz);
  }

  if (cat.type === "length") {
    return Math.abs(Number(guess) - Number(actual));
  }

  if (cat.type === "datetime") {
    // For standalone: closest date (ignore time for proximity)
    if (!actual.date) return null;
    const actualMs = new Date(actual.date).getTime();
    if (guess.isRange) {
      const from = new Date(guess.date).getTime();
      const to = new Date(guess.dateTo).getTime();
      if (actualMs >= from && actualMs <= to) return 0; // inside range — wins at half value
      return Math.min(Math.abs(actualMs - from), Math.abs(actualMs - to));
    }
    return Math.abs(new Date(guess.date).getTime() - actualMs);
  }

  return null;
}

// Returns "win" | "loss" for a parlay leg
function scoreParlayLeg(cat, guess, actual) {
  if (!guess || !actual) return "loss";

  if (cat.type === "choice") return guess === actual ? "win" : "loss";

  if (cat.type === "number") return Number(guess) === Number(actual) ? "win" : "loss";

  if (cat.type === "weight") {
    const guessOz = Number(guess.lbs) * 16 + Number(guess.oz ?? 0);
    const actualOz = Number(actual.lbs) * 16 + Number(actual.oz ?? 0);
    return Math.abs(guessOz - actualOz) <= 3 ? "win" : "loss"; // within 3 oz
  }

  if (cat.type === "length") {
    return Math.abs(Number(guess) - Number(actual)) <= 0.25 ? "win" : "loss"; // within ¼ inch
  }

  if (cat.type === "datetime") {
    if (!actual.date) return "loss";
    if (guess.isRange) {
      const actualMs = new Date(actual.date).getTime();
      const from = new Date(guess.date).getTime();
      const to = new Date(guess.dateTo).getTime();
      return actualMs >= from && actualMs <= to ? "win" : "loss";
    }
    return guess.date === actual.date ? "win" : "loss";
  }

  return "loss";
}

// Given actuals, compute per-category standalone results
function computeStandaloneResults(submissions, actuals) {
  const results = {};
  CATEGORIES.forEach(cat => {
    const actual = actuals[cat.id];
    if (!actual || !valueComplete(cat, actual)) { results[cat.id] = null; return; }

    const bettors = submissions
      .filter(sub => sub.bets[cat.id]?.active)
      .map(sub => ({ name: sub.name, guess: sub.bets[cat.id].value }));

    if (bettors.length === 0) { results[cat.id] = { bettors: [], winners: [], pot: 0 }; return; }

    const pot = bettors.length * CAT_FEE;

    if (cat.type === "choice") {
      const winners = bettors.filter(b => b.guess === actual);
      results[cat.id] = { bettors, winners, pot, split: winners.length > 1 };
    } else {
      // proximity: find minimum distance
      const scored = bettors.map(b => ({ ...b, dist: scoreStandalone(cat, b.guess, actual) }));
      const minDist = Math.min(...scored.map(b => b.dist ?? Infinity));
      const winners = scored.filter(b => b.dist === minDist);
      results[cat.id] = { bettors: scored, winners, pot, split: winners.length > 1, minDist };
    }
  });
  return results;
}

// Compute parlay results for all submissions
function computeParlayResults(submissions, actuals) {
  return submissions.flatMap(sub =>
    sub.parlays.map(parlay => {
      const legResults = parlay.legs.map(leg => {
        const cat = CATEGORIES.find(c => c.id === leg.catId);
        const actual = actuals[leg.catId];
        const hit = actual && valueComplete(cat, actual)
          ? scoreParlayLeg(cat, leg.value, actual) === "win"
          : null; // null = not yet scored
        return { ...leg, hit };
      });
      const allScored = legResults.every(l => l.hit !== null);
      const won = allScored && legResults.every(l => l.hit === true);
      return { ...parlay, bettor: sub.name, legResults, allScored, won };
    })
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg:       "#fff4f8",
  surface:  "rgba(255,255,255,0.7)",
  border:   "rgba(220,90,155,0.22)",
  gold:     "#d4478a",
  goldDim:  "rgba(212,71,138,0.38)",
  goldFaint:"rgba(212,71,138,0.11)",
  text:     "#3a0d22",
  muted:    "#a06880",
  dim:      "#d8aabf",
  green:    "#28a870",
  red:      "#e04a4a",
};

const S = {
  page: {
    minHeight: "100vh",
    background: `radial-gradient(ellipse at 25% 10%, #ffe4f0 0%, #fff4f8 50%, #f8eeff 100%)`,
    color: C.text,
    fontFamily: "'Georgia', 'Times New Roman', serif",
    paddingBottom: 80,
  },
  wrap: { maxWidth: 580, margin: "0 auto", padding: "0 20px" },
  goldBar: {
    height: 1,
    background: `linear-gradient(90deg, transparent, ${C.gold}55, ${C.gold}, ${C.gold}55, transparent)`,
    margin: "20px 0",
  },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "16px 18px",
  },
  cardActive: {
    background: C.goldFaint,
    border: `1px solid ${C.goldDim}`,
    borderRadius: 12,
    padding: "16px 18px",
  },
  btn: (variant = "primary") => ({
    padding: "11px 22px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontFamily: "'Georgia', serif",
    fontWeight: 700,
    fontSize: 15,
    letterSpacing: 0.5,
    transition: "all 0.15s",
    ...(variant === "primary" ? {
      background: `linear-gradient(135deg, ${C.gold}, #a02060)`,
      color: "#fff",
    } : variant === "ghost" ? {
      background: "transparent",
      border: `1px solid ${C.goldDim}`,
      color: C.gold,
    } : variant === "danger" ? {
      background: "transparent",
      border: `1px solid rgba(224,90,74,0.4)`,
      color: C.red,
    } : {
      background: C.surface,
      border: `1px solid ${C.border}`,
      color: C.muted,
    }),
  }),
  input: {
    background: "rgba(255,255,255,0.85)",
    border: `1px solid ${C.goldDim}`,
    borderRadius: 7,
    color: C.text,
    padding: "9px 13px",
    fontSize: 15,
    fontFamily: "Georgia, serif",
    outline: "none",
    width: 140,
    boxSizing: "border-box",
  },
  label: {
    fontSize: 11,
    letterSpacing: 3,
    color: C.gold,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 6,
  },
  tag: (color = C.gold) => ({
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 20,
    border: `1px solid ${color}55`,
    color: color,
    background: `${color}11`,
  }),
};

// ─── Inputs ───────────────────────────────────────────────────────────────────

function WeightInput({ value = {}, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input type="number" min="4" max="14" placeholder="lbs"
        value={value.lbs ?? ""} onChange={e => onChange({ ...value, lbs: e.target.value })}
        style={{ ...S.input, width: 80 }} />
      <span style={{ color: C.gold, fontSize: 13 }}>lbs</span>
      <input type="number" min="0" max="15" placeholder="oz"
        value={value.oz ?? ""} onChange={e => onChange({ ...value, oz: e.target.value })}
        style={{ ...S.input, width: 80 }} />
      <span style={{ color: C.gold, fontSize: 13 }}>oz</span>
    </div>
  );
}

function DatetimeInput({ value = {}, onChange, dateOnly = false, rangeAllowed = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!value.isRange ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="date" value={value.date ?? ""}
            onChange={e => onChange({ ...value, date: e.target.value })}
            style={{ ...S.input, width: 160, color: "#000" }} />
          {!dateOnly && (
            <input type="time" value={value.time ?? ""}
              onChange={e => onChange({ ...value, time: e.target.value })}
              style={{ ...S.input, width: 130, color: "#000" }} />
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={value.date ?? ""}
            onChange={e => onChange({ ...value, date: e.target.value })}
            style={{ ...S.input, width: 160, color: "#000" }} />
          <span style={{ color: C.muted }}>to</span>
          <input type="date" value={value.dateTo ?? ""}
            onChange={e => onChange({ ...value, dateTo: e.target.value })}
            style={{ ...S.input, width: 160 }} />
        </div>
      )}
      {rangeAllowed && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontSize: 12, color: C.muted }}>
          <input type="checkbox" checked={!!value.isRange}
            onChange={e => onChange({ ...value, isRange: e.target.checked })}
            style={{ accentColor: C.gold }} />
          Bet a date range (½ point payout)
        </label>
      )}
      {dateOnly && (
        <div style={{ fontSize: 11, color: C.dim }}>Time not used in parlays — date only.</div>
      )}
    </div>
  );
}

function ValueInput({ cat, value, onChange, parlayMode = false }) {
  if (cat.type === "choice") return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {cat.options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          padding: "5px 13px", borderRadius: 20, border: `1px solid ${value === opt ? C.gold : C.goldDim}`,
          background: value === opt ? C.gold : "transparent",
          color: value === opt ? "#fff" : C.gold,
          fontSize: 13, cursor: "pointer", fontFamily: "Georgia,serif", transition: "all 0.12s",
        }}>{opt}</button>
      ))}
    </div>
  );
  if (cat.type === "weight") return <WeightInput value={value} onChange={onChange} />;
  if (cat.type === "datetime") return <DatetimeInput value={value} onChange={onChange} dateOnly={parlayMode && cat.parlayDateOnly} rangeAllowed={parlayMode} />;
  if (cat.type === "length") return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input type="number" min="14" max="24" step="0.25" placeholder="e.g. 20.5"
        value={value ?? ""} onChange={e => onChange(e.target.value)}
        style={{ ...S.input, width: 110 }} />
      <span style={{ color: C.gold, fontSize: 13 }}>inches</span>
    </div>
  );
  if (cat.type === "number") return (
    <input type="number" min={cat.min} max={cat.max} placeholder={`${cat.min}–${cat.max}`}
      value={value ?? ""} onChange={e => onChange(e.target.value)}
      style={{ ...S.input, width: 100 }} />
  );
  return null;
}

// ─── Screens ──────────────────────────────────────────────────────────────────

function Intro({ onStart, submissions }) {
  const [name, setName] = useState("");

  const isDuplicate = name.trim() &&
    submissions.some(s => s.name.toLowerCase() === name.trim().toLowerCase());

  function tryStart() {
    if (!name.trim() || isDuplicate) return;
    onStart(name.trim());
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start", minHeight: "100vh" }}>

      {/* ── Left panel: who has bet ── */}
      <div style={{ width: 230, minWidth: 230, padding: "60px 16px 60px 20px", borderRight: `1px solid ${C.border}`, minHeight: "100vh" }}>
        <div style={S.label}>Bets placed</div>
        {submissions.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 13, marginTop: 8 }}>No bets yet!</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {submissions.map((sub, i) => {
              const activeCats = CATEGORIES.filter(c => sub.bets[c.id]?.active);
              return (
                <div key={i} style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 5 }}>{sub.name}</div>
                  {activeCats.map(cat => (
                    <div key={cat.id} style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>· {cat.shortLabel}</div>
                  ))}
                  {sub.parlays.length > 0 && (
                    <div style={{ fontSize: 12, color: C.gold, marginTop: 3 }}>
                      + {sub.parlays.length} parlay{sub.parlays.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Right panel: main form ── */}
      <div style={{ flex: 1, paddingTop: 70, paddingBottom: 80, textAlign: "center" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 20px" }}>
          <div style={{ fontSize: 11, letterSpacing: 6, color: C.gold, textTransform: "uppercase", marginBottom: 18 }}>
            Baby Shower · Prediction Game
          </div>
          <h1 style={{ fontSize: 52, fontWeight: 400, margin: "0 0 6px", lineHeight: 1.1, color: C.text }}>
            Place<br />Your Bets
          </h1>
          <div style={S.goldBar} />
          <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.7, maxWidth: 340, margin: "0 auto 36px" }}>
            Bet on individual categories for $3 each. Build as many parlays as you like.
            May the odds be ever in your favor.
          </p>
          <div style={{ textAlign: "left", maxWidth: 360, margin: "0 auto 8px" }}>
            <label style={S.label}>Your name</label>
            <input type="text" placeholder="e.g. Aunt Sophie"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && tryStart()}
              style={{ ...S.input, width: "100%", fontSize: 18, padding: "12px 16px",
                border: `1px solid ${isDuplicate ? C.red : C.goldDim}` }} />
          </div>

          {isDuplicate && (
            <div style={{ maxWidth: 360, margin: "0 auto 16px", padding: "10px 14px", background: "rgba(224,90,74,0.08)", border: `1px solid rgba(224,90,74,0.3)`, borderRadius: 8, textAlign: "left" }}>
              <div style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                That name already has a bet.
              </div>
              <div style={{ color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
                Please enter a different name. If you want to edit your existing bets, find <strong style={{ color: C.text }}>Will</strong> and ask him to remove your old entry.
              </div>
            </div>
          )}

          {!isDuplicate && <div style={{ marginBottom: 24 }} />}

          <button onClick={tryStart}
            disabled={!name.trim() || !!isDuplicate}
            style={{ ...S.btn("primary"), width: 280, padding: "14px", fontSize: 16, opacity: name.trim() && !isDuplicate ? 1 : 0.4 }}>
            Enter the Parlor →
          </button>
          <p style={{ color: C.muted, fontSize: 17, marginTop: 16 }}>
            $3 per standalone bet · parlays $1–$50 · unlimited parlays
          </p>
        </div>
      </div>
    </div>
  );
}

function StandaloneForm({ name, existing, onSave }) {
  const [bets, setBets] = useState(() => {
    const base = existing || {};
    if (base.birthdate?.value) return base;
    return { ...base, birthdate: { ...base.birthdate, value: { date: "2026-08-11" } } };
  });

  const activeCats = CATEGORIES.filter(c => bets[c.id]?.active);
  const total = activeCats.length * CAT_FEE;

  function toggle(id) {
    setBets(b => ({ ...b, [id]: { ...b[id], active: !b[id]?.active } }));
  }
  function setVal(id, val) {
    setBets(b => ({ ...b, [id]: { ...b[id], value: val } }));
  }

  const allComplete = activeCats.every(c => valueComplete(c, bets[c.id]?.value));

  return (
    <div style={S.wrap}>
      <div style={{ paddingTop: 36, marginBottom: 8 }}>
        <div style={S.label}>Standalone bets · {name}</div>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>Pick your categories</h2>
        <p style={{ color: C.muted, fontSize: 19, margin: "6px 0 0" }}>
          $3 per category · pot split among winners
        </p>
      </div>
      <div style={S.goldBar} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {CATEGORIES.map(cat => {
          const active = !!bets[cat.id]?.active;
          const val = bets[cat.id]?.value;
          const complete = active && valueComplete(cat, val);
          return (
            <div key={cat.id} style={active ? S.cardActive : S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: active ? 12 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {active && (
                    <span style={{ fontSize: 16 }}>{complete ? "✓" : "○"}</span>
                  )}
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: active ? C.text : C.muted }}>
                      {cat.label}
                      {!cat.parlayAllowed && (
                        <span style={{ ...S.tag(C.muted), marginLeft: 8, fontSize: 10 }}>standalone only</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 1 }}>{!cat.parlayAllowed ? "Standalone only · closest guess wins" : ""}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {active && <span style={{ ...S.tag(), fontSize: 18, padding: "5px 15px", fontWeight: 700 }}>{fmtMoney(CAT_FEE)}</span>}
                  <button onClick={() => toggle(cat.id)} style={{
                    ...S.btn(active ? "primary" : "ghost"),
                    padding: "5px 14px", fontSize: 13,
                  }}>{active ? "In ✓" : "+ Bet"}</button>
                </div>
              </div>
              {active && <ValueInput cat={cat} value={val} onChange={v => setVal(cat.id, v)} />}
            </div>
          );
        })}
      </div>

      {activeCats.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: C.muted, fontSize: 13 }}>Standalone total</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.gold }}>{fmtMoney(total)}</div>
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>{activeCats.length} categor{activeCats.length === 1 ? "y" : "ies"}</div>
        </div>
      )}

      <button onClick={() => onSave(bets)}
        disabled={!allComplete}
        style={{ ...S.btn("primary"), width: "100%", padding: 14, fontSize: 16, opacity: allComplete ? 1 : 0.4 }}>
        {activeCats.length === 0 ? "Skip to Parlays →" : "Save & Add Parlays →"}
      </button>
      {activeCats.length > 0 && !allComplete && (
        <p style={{ textAlign: "center", color: C.red, fontSize: 12, marginTop: 8 }}>Fill in all active categories to continue.</p>
      )}
    </div>
  );
}

function ParlayBuilder({ name, parlays, onSave, onDelete, onDone, onBack }) {
  const [legs, setLegs] = useState({});  // catId -> value
  const [stake, setStake] = useState(5);
  const [activeLegIds, setActiveLegIds] = useState([]);

  function toggleLeg(id) {
    if (activeLegIds.includes(id)) {
      setActiveLegIds(a => a.filter(x => x !== id));
      setLegs(l => { const n = { ...l }; delete n[id]; return n; });
    } else {
      setActiveLegIds(a => [...a, id]);
    }
  }

  function setLegVal(id, val) { setLegs(l => ({ ...l, [id]: val })); }

  const n = activeLegIds.length;
  const payout = n >= 2 ? parlayPayout(stake, n) : 0;
  const allLegsComplete = activeLegIds.every(id => {
    const cat = CATEGORIES.find(c => c.id === id);
    return valueComplete(cat, legs[id]);
  });
  const canAdd = n >= 2 && allLegsComplete && stake >= 1 && stake <= 50;

  function addParlay() {
    const parlay = {
      id: Date.now(),
      legs: activeLegIds.map(id => ({ catId: id, value: legs[id] })),
      stake: Number(stake),
      payout,
    };
    onSave(parlay);
    setLegs({});
    setActiveLegIds([]);
    setStake(5);
  }

  return (
    <div style={S.wrap}>
      <div style={{ paddingTop: 36, marginBottom: 8 }}>
        <button onClick={onBack} style={{ ...S.btn("ghost"), padding: "5px 14px", fontSize: 13, marginBottom: 16 }}>← Back to Standalone</button>
        <div style={S.label}>Parlays · {name}</div>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>Build a parlay</h2>
        <p style={{ color: C.muted, fontSize: 19, margin: "6px 0 0" }}>
          Pick 2+ legs · set your stake · submit as many as you like
        </p>
      </div>
      <div style={S.goldBar} />

      {/* Existing parlays */}
      {parlays.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={S.label}>Your parlays so far</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {parlays.map((p, i) => (
              <div key={p.id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                    Parlay #{i + 1} · {p.legs.length} legs
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                    {p.legs.map(l => CATEGORIES.find(c => c.id === l.catId)?.shortLabel).join(" · ")}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.gold, fontWeight: 700 }}>{fmtMoney(p.stake)} → {fmtMoney(p.payout)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{p.legs.length}× odds</div>
                  </div>
                  <button onClick={() => onDelete(p.id)}
                    style={{ ...S.btn("danger"), padding: "4px 10px", fontSize: 12 }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Builder */}
      <div style={{ marginBottom: 16 }}>
        <div style={S.label}>Select legs</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CATEGORIES.filter(cat => cat.parlayAllowed).map(cat => {
            const active = activeLegIds.includes(cat.id);
            const val = legs[cat.id];
            const complete = active && valueComplete(cat, val);
            return (
              <div key={cat.id} style={active ? S.cardActive : S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: active ? 12 : 0 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: active ? C.text : C.muted }}>{cat.label}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>{cat.parlayNote}</div>
                  </div>
                  <button onClick={() => toggleLeg(cat.id)} style={{
                    ...S.btn(active ? "primary" : "ghost"),
                    padding: "5px 14px", fontSize: 13,
                  }}>{active ? `✓ ${complete ? "✔" : "…"}` : "+ Add"}</button>
                </div>
                {active && <ValueInput cat={cat} value={val} onChange={v => setLegVal(cat.id, v)} parlayMode={true} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stake */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.label}>Stake ($1–$50)</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <input type="number" min="1" max="50" value={stake}
            onChange={e => setStake(Math.min(50, Math.max(1, Number(e.target.value))))}
            style={{ ...S.input, width: 90, fontSize: 18 }} />
          {[1, 5, 10, 20, 50].map(v => (
            <button key={v} onClick={() => setStake(v)} style={{
              ...S.btn(stake === v ? "primary" : "ghost"),
              padding: "6px 14px", fontSize: 14,
            }}>{fmtMoney(v)}</button>
          ))}
        </div>
        {n >= 2 && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(212,168,67,0.08)", borderRadius: 8, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.muted, fontSize: 14 }}>{n}-leg parlay · {n}× true odds</span>
            <span style={{ color: C.gold, fontWeight: 700, fontSize: 16 }}>{fmtMoney(stake)} → {fmtMoney(payout)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={addParlay} disabled={!canAdd}
          style={{ ...S.btn("primary"), flex: 1, padding: 13, fontSize: 15, opacity: canAdd ? 1 : 0.4 }}>
          Add This Parlay
        </button>
        <button onClick={onDone}
          style={{ ...S.btn("ghost"), flex: 1, padding: 13, fontSize: 15 }}>
          {parlays.length > 0 ? "Done →" : "Skip parlays →"}
        </button>
      </div>
      {n < 2 && n > 0 && <p style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 8 }}>Select at least 2 legs for a parlay.</p>}
    </div>
  );
}

function Summary({ name, bets, parlays, onConfirm, onBack }) {
  const activeCats = CATEGORIES.filter(c => bets[c.id]?.active);
  const standTotal = activeCats.length * CAT_FEE;
  const parlayTotal = parlays.reduce((s, p) => s + p.stake, 0);
  const grandTotal = standTotal + parlayTotal;

  return (
    <div style={S.wrap}>
      <div style={{ paddingTop: 36, marginBottom: 8 }}>
        <button onClick={onBack} style={{ ...S.btn("ghost"), padding: "5px 14px", fontSize: 13, marginBottom: 16 }}>← Back</button>
        <div style={S.label}>Review slip · {name}</div>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>Confirm your bets</h2>
      </div>
      <div style={S.goldBar} />

      {activeCats.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={S.label}>Standalone bets</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activeCats.map(cat => (
              <div key={cat.id} style={{ ...S.card, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.muted, fontSize: 14 }}>{cat.label}</span>
                <span style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>{fmtValue(cat.id, bets[cat.id]?.value)}</span>
              </div>
            ))}
            <div style={{ textAlign: "right", color: C.muted, fontSize: 13, marginTop: 2 }}>
              {activeCats.length} × {fmtMoney(CAT_FEE)} = <strong style={{ color: C.gold }}>{fmtMoney(standTotal)}</strong>
            </div>
          </div>
        </div>
      )}

      {parlays.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={S.label}>Parlays</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {parlays.map((p, i) => (
              <div key={p.id} style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: C.text }}>Parlay #{i+1} · {p.legs.length} legs</span>
                  <span style={{ color: C.gold, fontWeight: 700 }}>{fmtMoney(p.stake)} → {fmtMoney(p.payout)}</span>
                </div>
                {p.legs.map(leg => {
                  const cat = CATEGORIES.find(c => c.id === leg.catId);
                  return (
                    <div key={leg.catId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, padding: "3px 0" }}>
                      <span>{cat.shortLabel}</span>
                      <span style={{ color: C.text }}>{fmtValue(leg.catId, leg.value)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ textAlign: "right", color: C.muted, fontSize: 13, marginTop: 2 }}>
              Parlay stakes: <strong style={{ color: C.gold }}>{fmtMoney(parlayTotal)}</strong>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...S.cardActive, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontSize: 16, color: C.muted }}>Total owed</span>
        <span style={{ fontSize: 28, fontWeight: 700, color: C.gold }}>{fmtMoney(grandTotal)}</span>
      </div>

      <button onClick={onConfirm} style={{ ...S.btn("primary"), width: "100%", padding: 14, fontSize: 16 }}>
        Lock It In 🔒
      </button>
    </div>
  );
}

function Confirmed({ name, bets, parlays, onReset }) {
  const activeCats = CATEGORIES.filter(c => bets[c.id]?.active);
  const grandTotal = activeCats.length * CAT_FEE + parlays.reduce((s, p) => s + p.stake, 0);
  return (
    <div style={{ ...S.wrap, paddingTop: 80, textAlign: "center" }}>
      <div style={{ fontSize: 52, marginBottom: 12 }}>🍼</div>
      <h2 style={{ fontSize: 36, fontWeight: 400, margin: "0 0 6px" }}>Locked In</h2>
      <div style={S.goldBar} />
      <p style={{ color: C.muted, lineHeight: 1.7 }}>
        <strong style={{ color: C.text }}>{name}</strong>, your slip is confirmed.<br />
        Venmo <strong style={{ color: C.gold }}>@WillyScripps</strong> the amount of <strong style={{ color: C.gold }}>{fmtMoney(grandTotal)}</strong>.<br />
        Last 4: <strong style={{ color: C.text }}>2861</strong>. Good luck!
      </p>
      <button onClick={onReset}
        style={{ ...S.btn("ghost"), marginTop: 28, padding: "10px 28px", fontSize: 14 }}>
        Next bettor →
      </button>
      <div style={{ ...S.card, textAlign: "left", marginTop: 24 }}>
        <div style={S.label}>Your slip</div>
        {activeCats.map(cat => (
          <div key={cat.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.muted }}>{cat.label}</span>
            <span>{fmtValue(cat.id, bets[cat.id]?.value)}</span>
          </div>
        ))}
        {parlays.map((p, i) => (
          <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
              <span style={{ color: C.gold }}>Parlay #{i+1}</span>
              <span style={{ color: C.gold }}>{fmtMoney(p.stake)} → {fmtMoney(p.payout)}</span>
            </div>
            {p.legs.map(l => (
              <div key={l.catId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, paddingLeft: 8, marginTop: 2 }}>
                <span>{CATEGORIES.find(c => c.id === l.catId)?.shortLabel}</span>
                <span style={{ color: C.text }}>{fmtValue(l.catId, l.value)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({ submissions, actuals, onSaveActuals, onDeleteSubmission, onClose }) {
  const [tab, setTab] = useState("overview");
  // Local draft of actuals while editing
  const [draft, setDraft] = useState(actuals || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const allCatBets = {}; // catId -> [{name, value}]
  CATEGORIES.forEach(c => { allCatBets[c.id] = []; });
  submissions.forEach(sub => {
    CATEGORIES.forEach(cat => {
      if (sub.bets[cat.id]?.active) {
        allCatBets[cat.id].push({ name: sub.name, value: sub.bets[cat.id].value });
      }
    });
  });

  const totalStandalone = submissions.reduce((s, sub) =>
    s + CATEGORIES.filter(c => sub.bets[c.id]?.active).length * CAT_FEE, 0);

  const allParlays = submissions.flatMap(sub =>
    sub.parlays.map(p => ({ ...p, bettor: sub.name })));
  const totalParlayStakes = allParlays.reduce((s, p) => s + p.stake, 0);
  const maxParlayLiability = allParlays.reduce((s, p) => s + p.payout, 0);

  // Scoring results (computed from saved actuals, not draft)
  const standResults = computeStandaloneResults(submissions, actuals || {});
  const parlayResults = computeParlayResults(submissions, actuals || {});

  // Total payouts per person from results
  function computePayouts() {
    const payouts = {}; // name -> { standalone: n, parlays: n }
    submissions.forEach(sub => { payouts[sub.name] = { standalone: 0, parlays: 0 }; });

    CATEGORIES.forEach(cat => {
      const res = standResults[cat.id];
      if (!res || res.winners.length === 0) return;
      const share = res.pot / res.winners.length;
      res.winners.forEach(w => {
        if (payouts[w.name]) payouts[w.name].standalone += share;
      });
    });

    parlayResults.forEach(p => {
      if (p.won && payouts[p.bettor]) {
        payouts[p.bettor].parlays += p.payout;
      }
    });

    return payouts;
  }

  const hasAnyActuals = actuals && CATEGORIES.some(c => valueComplete(c, actuals[c.id]));
  const hasResults = hasAnyActuals;

  function handleSaveActuals() {
    setSaving(true);
    onSaveActuals(draft);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const TabBtn = ({ id, label, badge }) => (
    <button onClick={() => setTab(id)} style={{
      ...S.btn(tab === id ? "primary" : "ghost"),
      padding: "7px 16px", fontSize: 13, position: "relative",
    }}>
      {label}
      {badge && (
        <span style={{
          position: "absolute", top: -4, right: -4,
          background: C.green, color: "#fff", borderRadius: 10,
          fontSize: 9, padding: "1px 5px", fontWeight: 700,
        }}>{badge}</span>
      )}
    </button>
  );

  return (
    <div style={{ ...S.page, paddingTop: 0 }}>
      <div style={{ background: "rgba(255,244,248,0.96)", borderBottom: `1px solid ${C.border}`, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: C.gold }}>HOST DASHBOARD</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => {
            const data = JSON.stringify({ submissions, actuals }, null, 2);
            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `baby-shower-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }} style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 12 }}>
            ↓ Export
          </button>
          <button onClick={onClose} style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 12 }}>← Guest view</button>
        </div>
      </div>

      <div style={S.wrap}>
        <div style={{ paddingTop: 28, marginBottom: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TabBtn id="overview" label="Overview" />
          <TabBtn id="categories" label="Categories" />
          <TabBtn id="parlays" label="Parlays" />
          <TabBtn id="bettors" label="Bettors" />
          <TabBtn id="actuals" label="Enter Actuals" />
          {hasResults && <TabBtn id="results" label="Results" badge="★" />}
        </div>

        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "Total bettors", value: submissions.length },
                { label: "Total parlays", value: allParlays.length },
                { label: "Standalone pot", value: fmtMoney(totalStandalone) },
                { label: "Parlay stakes in", value: fmtMoney(totalParlayStakes) },
              ].map(({ label, value }) => (
                <div key={label} style={{ ...S.card, textAlign: "center" }}>
                  <div style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{label}</div>
                  <div style={{ color: C.gold, fontSize: 26, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ ...S.cardActive, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ color: C.muted, fontSize: 12 }}>Max parlay liability (if all hit)</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>Worst-case payout from you</div>
              </div>
              <div style={{ color: C.red, fontSize: 28, fontWeight: 700 }}>{fmtMoney(maxParlayLiability)}</div>
            </div>
            <div style={{ ...S.card }}>
              <div style={S.label}>Category action</div>
              {CATEGORIES.map(cat => {
                const bettors = allCatBets[cat.id];
                const pot = bettors.length * CAT_FEE;
                return (
                  <div key={cat.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ color: C.muted, fontSize: 13 }}>{cat.label}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ color: C.muted, fontSize: 12 }}>{bettors.length} bet{bettors.length !== 1 ? "s" : ""}</span>
                      <span style={{ color: C.gold, fontWeight: 600, fontSize: 14 }}>{fmtMoney(pot)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "categories" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {CATEGORIES.map(cat => {
              const bettors = allCatBets[cat.id];
              return (
                <div key={cat.id} style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{cat.label}</div>
                    <div style={{ color: C.gold, fontWeight: 700 }}>{fmtMoney(bettors.length * CAT_FEE)} pot</div>
                  </div>
                  {bettors.length === 0 ? (
                    <div style={{ color: C.dim, fontSize: 13 }}>No bets yet</div>
                  ) : bettors.map((b, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ color: C.muted }}>{b.name}</span>
                      <span>{fmtValue(cat.id, b.value)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {tab === "parlays" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {allParlays.length === 0 && <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>No parlays yet.</div>}
            {allParlays.map((p, i) => (
              <div key={p.id} style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{p.bettor}</span>
                    <span style={{ color: C.muted, fontSize: 13 }}> · {p.legs.length}-leg parlay</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: C.gold, fontWeight: 700 }}>{fmtMoney(p.stake)} → {fmtMoney(p.payout)}</div>
                    <div style={{ fontSize: 11, color: C.dim }}>2^{p.legs.length - 1}× odds</div>
                  </div>
                </div>
                {p.legs.map(leg => {
                  const cat = CATEGORIES.find(c => c.id === leg.catId);
                  return (
                    <div key={leg.catId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, padding: "3px 0" }}>
                      <span>{cat.label}</span>
                      <span style={{ color: C.text }}>{fmtValue(leg.catId, leg.value)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ ...S.cardActive, display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ color: C.muted }}>Total max liability</span>
              <span style={{ color: C.red, fontWeight: 700, fontSize: 18 }}>{fmtMoney(maxParlayLiability)}</span>
            </div>
          </div>
        )}

        {tab === "bettors" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {submissions.length === 0 && <div style={{ color: C.muted, textAlign: "center", padding: 40 }}>No submissions yet.</div>}
            {submissions.map((sub, i) => {
              const activeCats = CATEGORIES.filter(c => sub.bets[c.id]?.active);
              const owed = activeCats.length * CAT_FEE + sub.parlays.reduce((s, p) => s + p.stake, 0);
              return (
                <div key={i} style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{sub.name}</div>
                      <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
                        {activeCats.length} standalone bet{activeCats.length !== 1 ? "s" : ""} · {sub.parlays.length} parlay{sub.parlays.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ color: C.gold, fontWeight: 700 }}>owes {fmtMoney(owed)}</div>
                      <button onClick={() => onDeleteSubmission(i)}
                        style={{ ...S.btn("danger"), padding: "4px 10px", fontSize: 12 }}>✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Enter Actuals ── */}
        {tab === "actuals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...S.card, background: "rgba(212,168,67,0.06)", border: `1px solid ${C.goldDim}` }}>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
                Enter the real values after baby arrives. Save at any time — you can fill categories in stages.
                Results update automatically once actuals are saved.
              </div>
            </div>

            {CATEGORIES.map(cat => {
              const val = draft[cat.id];
              const complete = valueComplete(cat, val);
              return (
                <div key={cat.id} style={complete ? S.cardActive : S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: complete ? C.text : C.muted }}>
                        {cat.label}
                      </div>
                      {complete && (
                        <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>✓ {fmtValue(cat.id, val)}</div>
                      )}
                    </div>
                    {complete && (
                      <button onClick={() => setDraft(d => { const n = { ...d }; delete n[cat.id]; return n; })}
                        style={{ ...S.btn("danger"), padding: "3px 10px", fontSize: 11 }}>Clear</button>
                    )}
                  </div>
                  <ValueInput
                    cat={cat}
                    value={val}
                    onChange={v => setDraft(d => ({ ...d, [cat.id]: v }))}
                    parlayMode={false}
                  />
                </div>
              );
            })}

            <button onClick={handleSaveActuals} disabled={saving}
              style={{ ...S.btn("primary"), width: "100%", padding: 14, fontSize: 16, marginTop: 8 }}>
              {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Actuals & Score"}
            </button>
            <p style={{ textAlign: "center", color: C.dim, fontSize: 12, marginTop: 0 }}>
              You can save partial actuals and come back to fill in the rest.
            </p>
          </div>
        )}

        {/* ── Results ── */}
        {tab === "results" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Per-person payout summary */}
            {(() => {
              const payouts = computePayouts();
              const names = Object.keys(payouts);
              const anyWinnings = names.some(n => payouts[n].standalone + payouts[n].parlays > 0);
              return (
                <div>
                  <div style={S.label}>Payouts to guests</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {names.length === 0 && (
                      <div style={{ color: C.muted, fontSize: 13 }}>No submissions yet.</div>
                    )}
                    {names.map(name => {
                      const { standalone, parlays: pWin } = payouts[name];
                      const total = standalone + pWin;
                      return (
                        <div key={name} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{name}</div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                              {standalone > 0 && `${fmtMoney(standalone)} standalone`}
                              {standalone > 0 && pWin > 0 && " · "}
                              {pWin > 0 && `${fmtMoney(pWin)} parlays`}
                              {total === 0 && "No wins yet"}
                            </div>
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: total > 0 ? C.green : C.dim }}>
                            {total > 0 ? fmtMoney(total) : "—"}
                          </div>
                        </div>
                      );
                    })}
                    {anyWinnings && (
                      <div style={{ ...S.cardActive, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: C.muted, fontSize: 13 }}>Total host pays out</span>
                        <span style={{ color: C.gold, fontWeight: 700, fontSize: 18 }}>
                          {fmtMoney(names.reduce((s, n) => s + payouts[n].standalone + payouts[n].parlays, 0))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <div style={S.goldBar} />

            {/* Standalone category results */}
            <div>
              <div style={S.label}>Standalone results</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {CATEGORIES.map(cat => {
                  const res = standResults[cat.id];
                  const actual = actuals?.[cat.id];
                  const hasActual = actual && valueComplete(cat, actual);

                  return (
                    <div key={cat.id} style={S.card}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: hasActual ? 10 : 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
                        {hasActual ? (
                          <span style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>
                            Actual: {fmtValue(cat.id, actual)}
                          </span>
                        ) : (
                          <span style={{ color: C.dim, fontSize: 12 }}>No actual yet</span>
                        )}
                      </div>

                      {hasActual && res && (
                        <>
                          {res.bettors.length === 0 && (
                            <div style={{ color: C.dim, fontSize: 13 }}>No bets on this category.</div>
                          )}
                          {res.bettors.map((b, i) => {
                            const isWinner = res.winners.some(w => w.name === b.name);
                            const share = isWinner ? res.pot / res.winners.length : 0;
                            return (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontSize: 14 }}>{isWinner ? "🏆" : "·"}</span>
                                  <span style={{ color: isWinner ? C.text : C.muted, fontSize: 13, fontWeight: isWinner ? 700 : 400 }}>
                                    {b.name}
                                  </span>
                                  <span style={{ color: C.dim, fontSize: 12 }}>{fmtValue(cat.id, b.guess ?? b.value)}</span>
                                </div>
                                <span style={{ color: isWinner ? C.green : C.dim, fontWeight: isWinner ? 700 : 400, fontSize: 13 }}>
                                  {isWinner ? `+${fmtMoney(share)}${res.split ? " (split)" : ""}` : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={S.goldBar} />

            {/* Parlay results */}
            <div>
              <div style={S.label}>Parlay results</div>
              {parlayResults.length === 0 && (
                <div style={{ color: C.muted, fontSize: 13 }}>No parlays submitted.</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {parlayResults.map((p, i) => {
                  const statusColor = !p.allScored ? C.muted : p.won ? C.green : C.red;
                  const statusLabel = !p.allScored ? "Pending" : p.won ? "WON 🏆" : "LOST";
                  return (
                    <div key={p.id} style={{ ...S.card, borderLeft: `3px solid ${statusColor}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{p.bettor}</span>
                          <span style={{ color: C.muted, fontSize: 13 }}> · {p.legs.length}-leg</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ color: statusColor, fontWeight: 700, fontSize: 14 }}>{statusLabel}</div>
                          <div style={{ color: C.gold, fontSize: 12 }}>
                            {fmtMoney(p.stake)} → {p.won ? fmtMoney(p.payout) : fmtMoney(0)}
                          </div>
                        </div>
                      </div>
                      {p.legResults.map(leg => {
                        const cat = CATEGORIES.find(c => c.id === leg.catId);
                        const hitColor = leg.hit === null ? C.muted : leg.hit ? C.green : C.red;
                        const hitIcon = leg.hit === null ? "?" : leg.hit ? "✓" : "✗";
                        return (
                          <div key={leg.catId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: C.muted }}>
                            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ color: hitColor, fontWeight: 700, minWidth: 12 }}>{hitIcon}</span>
                              {cat.shortLabel}
                            </span>
                            <span style={{ color: C.dim }}>
                              {fmtValue(leg.catId, leg.value)}
                              {actuals?.[leg.catId] && valueComplete(cat, actuals[leg.catId]) && (
                                <span style={{ color: C.gold, marginLeft: 6 }}>
                                  (actual: {fmtValue(leg.catId, actuals[leg.catId])})
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Host Login ───────────────────────────────────────────────────────────────

function HostLogin({ onAuth, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  function attempt() {
    if (pin === HOST_PIN) { onAuth(); }
    else { setErr(true); setTimeout(() => setErr(false), 1200); }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ ...S.card, maxWidth: 320, width: "90%", textAlign: "center", padding: 32 }}>
        <div style={S.label}>Host access</div>
        <h3 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 400 }}>Enter PIN</h3>
        <input type="password" placeholder="••••" value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key === "Enter" && attempt()}
          style={{ ...S.input, width: "100%", textAlign: "center", fontSize: 24, letterSpacing: 8, marginBottom: 12,
            border: `1px solid ${err ? C.red : C.goldDim}` }} />
        {err && <p style={{ color: C.red, fontSize: 13, margin: "0 0 12px" }}>Wrong PIN</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ ...S.btn("ghost"), flex: 1, padding: 10 }}>Cancel</button>
          <button onClick={attempt} style={{ ...S.btn("primary"), flex: 1, padding: 10 }}>Enter</button>
        </div>
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "baby-shower-submissions";
const ACTUALS_KEY = "baby-shower-actuals";

export default function App() {
  const [screen, setScreen] = useState("intro"); // intro | standalone | parlays | summary | confirmed
  const [name, setName] = useState("");
  const [bets, setBets] = useState({});
  const [parlays, setParlays] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [actuals, setActuals] = useState({});
  const [showHostLogin, setShowHostLogin] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  // Load submissions and actuals from artifact storage on mount
  useEffect(() => {
    // localStorage reads are synchronous
      try {
        const result = _localGet(STORAGE_KEY);
        if (result?.value) setSubmissions(JSON.parse(result.value));
      } catch {}
      try {
        const aResult = _localGet(ACTUALS_KEY);
        if (aResult?.value) setActuals(JSON.parse(aResult.value));
      } catch {}
      setStorageReady(true);
  }, []);

  function saveSubmissions(subs: any) {
    setSubmissions(subs);
    try {
      _localSet(STORAGE_KEY, JSON.stringify(subs));
    } catch (e) {
      console.error("Storage save failed:", e);
    }
  }

  function saveActuals(newActuals: any) {
    setActuals(newActuals);
    try {
      _localSet(ACTUALS_KEY, JSON.stringify(newActuals));
    } catch (e) {
      console.error("Actuals save failed:", e);
    }
  }

  function resetToIntro() {
    // Also remove any persisted record for this bettor (e.g. if they somehow got saved mid-flow)
    saveSubmissions(submissions.filter(s => s.name !== name));
    setName(""); setBets({}); setParlays([]);
    setScreen("intro");
    setShowHomeConfirm(false);
  }

  function confirm() {
    const sub = { name, bets, parlays, submittedAt: Date.now() };
    saveSubmissions([...submissions, sub]);
    setScreen("confirmed");
  }

  if (!storageReady) return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: C.muted }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🍼</div>
        <div style={{ fontSize: 14, letterSpacing: 2 }}>Loading...</div>
      </div>
    </div>
  );

  if (showHost) return (
    <div style={S.page}>
      <HostDashboard
        submissions={submissions}
        actuals={actuals}
        onSaveActuals={saveActuals}
        onDeleteSubmission={i => saveSubmissions(submissions.filter((_, idx) => idx !== i))}
        onClose={() => setShowHost(false)}
      />
    </div>
  );

  return (
    <div style={S.page}>
      {showHostLogin && (
        <HostLogin onAuth={() => { setShowHostLogin(false); setShowHost(true); }}
          onCancel={() => setShowHostLogin(false)} />
      )}

      {/* Home button — top left, visible mid-flow only */}
      {(screen === "standalone" || screen === "parlays" || screen === "summary") && (
        <div style={{ position: "fixed", top: 14, left: 16, zIndex: 50 }}>
          <button onClick={() => setShowHomeConfirm(true)}
            style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11, opacity: 0.5 }}>
            ⌂ Home
          </button>
        </div>
      )}

      {/* Home confirmation speed bump */}
      {showHomeConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ ...S.card, maxWidth: 320, width: "90%", textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 400, color: C.text }}>Leave without locking in?</h3>
            <p style={{ color: C.muted, fontSize: 14, margin: "0 0 24px", lineHeight: 1.6 }}>
              Your bets for <strong style={{ color: C.text }}>{name}</strong> will be discarded.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowHomeConfirm(false)}
                style={{ ...S.btn("ghost"), flex: 1, padding: 10 }}>Stay</button>
              <button onClick={resetToIntro}
                style={{ ...S.btn("danger"), flex: 1, padding: 10 }}>Leave</button>
            </div>
          </div>
        </div>
      )}

      {/* Host button — subtle, top right */}
      {screen !== "confirmed" && (
        <div style={{ position: "fixed", top: 14, right: 16, zIndex: 50 }}>
          <button onClick={() => setShowHostLogin(true)}
            style={{ ...S.btn("ghost"), padding: "5px 12px", fontSize: 11, opacity: 0.5 }}>
            Host
          </button>
        </div>
      )}

      {screen === "intro" && (
        <Intro submissions={submissions} onStart={n => { setName(n); setScreen("standalone"); }} />
      )}
      {screen === "standalone" && (
        <StandaloneForm name={name} existing={bets}
          onSave={b => { setBets(b); setScreen("parlays"); }} />
      )}
      {screen === "parlays" && (
        <ParlayBuilder name={name} parlays={parlays}
          onBack={() => setScreen("standalone")}
          onSave={p => setParlays(prev => [...prev, p])}
          onDelete={id => setParlays(prev => prev.filter(p => p.id !== id))}
          onDone={() => setScreen("summary")} />
      )}
      {screen === "summary" && (
        <Summary name={name} bets={bets} parlays={parlays}
          onConfirm={confirm}
          onBack={() => setScreen("parlays")} />
      )}
      {screen === "confirmed" && (
        <Confirmed name={name} bets={bets} parlays={parlays} onReset={() => {
          setName(""); setBets({}); setParlays([]); setScreen("intro");
        }} />
      )}
    </div>
  );
}

