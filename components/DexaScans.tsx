"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Trash2, Upload, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { primaryBtnStyle, ghostBtnStyle, inputStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { localDateStr } from "@/lib/date";
import type { DexaScan } from "@/lib/types";

// Upload a DEXA report, see what was read off it, and keep a dated series.
//
// The numbers matter more than the file: scale weight can't separate fat from
// lean tissue, so these scans are the only direct evidence for "am I holding
// muscle?" — which is what the plan builder reads them for.

function fmt(n: number | null, unit: string, digits = 1): string {
  return n == null ? "—" : `${Number(n).toFixed(digits)}${unit}`;
}

/** Change between two scans, oldest→newest, for the fields worth trending. */
function delta(newer: DexaScan, older: DexaScan) {
  const d = (a: number | null, b: number | null) =>
    a == null || b == null ? null : Number(a) - Number(b);
  return {
    fat: d(newer.fat_mass_lb, older.fat_mass_lb),
    lean: d(newer.lean_mass_lb, older.lean_mass_lb),
    pct: d(newer.body_fat_pct, older.body_fat_pct),
  };
}

function DeltaLine({ scan, prev }: { scan: DexaScan; prev: DexaScan }) {
  const d = delta(scan, prev);
  // Fat down and lean up are both wins, so they colour independently rather
  // than by raw sign.
  const chip = (label: string, value: number | null, goodWhenNegative: boolean) => {
    if (value == null) return null;
    const good = goodWhenNegative ? value < 0 : value > 0;
    const sign = value > 0 ? "+" : "";
    return (
      <span style={{ color: Math.abs(value) < 0.05 ? "var(--muted)" : good ? "#7fd494" : "#ff8a6a" }}>
        {label} {sign}{value.toFixed(1)}
      </span>
    );
  };
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontFamily: "var(--font-body)", fontSize: 11.5, marginTop: 4 }}>
      <span style={{ color: "#5a5a60" }}>vs {prev.scan_date}:</span>
      {chip("fat", d.fat, true)}
      {chip("lean", d.lean, false)}
      {chip("bf%", d.pct, true)}
    </div>
  );
}

export function DexaScans() {
  const supabase = createClient();
  const [scans, setScans] = useState<DexaScan[]>([]);
  const [scanDate, setScanDate] = useState(localDateStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch returns rows rather than setting state, so the mount effect can set
  // state from the resolved promise instead of synchronously in its body.
  const fetchScans = useCallback(async (): Promise<DexaScan[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("dexa_scans")
      .select("*")
      .eq("user_id", user.id)
      .order("scan_date", { ascending: false });
    return (data ?? []) as DexaScan[];
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    fetchScans().then((rows) => { if (!cancelled) setScans(rows); });
    return () => { cancelled = true; };
  }, [fetchScans]);

  const load = useCallback(async () => { setScans(await fetchScans()); }, [fetchScans]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("scanDate", scanDate);
      const res = await fetch("/api/dexa", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(json?.error || `Upload failed (${res.status})`);
      // The date printed on the report is worth surfacing when it disagrees
      // with the one picked — a misdated scan silently distorts every trend.
      if (json.reportDate && json.reportDate !== scanDate) {
        setNotice(`Saved under ${scanDate}. The report itself is dated ${json.reportDate} — re-upload with that date if it's the right one.`);
      } else {
        setNotice("Scan saved.");
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/dexa?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Couldn't delete that scan.");
      }
      setConfirmDelete(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Label icon={Activity}>DEXA scans</Label>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
        Upload the PDF and Cadence reads the numbers off it. Scale weight can&apos;t tell fat from muscle —
        these can, and every plan build uses them to judge whether you&apos;re holding lean mass.
      </div>

      <label style={{ display: "block", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.04em", marginBottom: 5 }}>
        SCAN DATE
      </label>
      <input
        type="date"
        value={scanDate}
        onChange={(e) => setScanDate(e.target.value)}
        disabled={busy}
        style={{ ...inputStyle, marginBottom: 10, colorScheme: "dark", WebkitAppearance: "none", appearance: "none", display: "block", maxWidth: "100%", minHeight: 44 }}
      />

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}
      >
        <Upload size={15} /> {busy ? "Reading the report…" : "Upload DEXA PDF"}
      </button>

      {error && <div style={{ color: "#ff8a6a", fontFamily: "var(--font-body)", fontSize: 12.5, marginTop: 8 }}>{error}</div>}
      {notice && <div style={{ color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12.5, marginTop: 8, lineHeight: 1.45 }}>{notice}</div>}

      {scans.length === 0 ? (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", marginTop: 14 }}>
          No scans yet. Two or more lets the coach track fat and lean mass separately over time.
        </div>
      ) : (
        scans.map((s, i) => {
          const prev = scans[i + 1]; // list is newest-first
          return (
            <div key={s.id} style={{ borderTop: "1px solid #2a2a2e", marginTop: 12, paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 13.5 }}>{s.scan_date}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                    <span>{fmt(s.body_fat_pct, "%")} body fat</span>
                    <span style={{ color: "#e0b56a" }}>fat {fmt(s.fat_mass_lb, " lb")}</span>
                    <span style={{ color: "#7fd494" }}>lean {fmt(s.lean_mass_lb, " lb")}</span>
                    {s.visceral_fat_lb != null && <span>visceral {fmt(s.visceral_fat_lb, " lb")}</span>}
                  </div>
                  {prev && <DeltaLine scan={s} prev={prev} />}
                  {s.extraction_notes && (
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6 }}>
                      <AlertTriangle size={12} style={{ color: "#f4c178", flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "#f4c178", lineHeight: 1.4 }}>
                        {s.extraction_notes}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setConfirmDelete(s.id)}
                  disabled={busy}
                  aria-label="Delete scan"
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "4px 6px", flexShrink: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {confirmDelete === s.id && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#ff8a6a", flex: 1 }}>Delete this scan and its PDF?</span>
                  <button onClick={() => remove(s.id)} style={{ ...ghostBtnStyle, fontSize: 12, color: "#ff8a6a", borderColor: "#ff8a6a" }}>Delete</button>
                  <button onClick={() => setConfirmDelete(null)} style={{ ...ghostBtnStyle, fontSize: 12 }}>Cancel</button>
                </div>
              )}
            </div>
          );
        })
      )}
    </Card>
  );
}
