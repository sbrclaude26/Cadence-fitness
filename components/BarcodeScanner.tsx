"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check } from "lucide-react";
import { primaryBtnStyle, ghostBtnStyle, inputStyle } from "@/components/ui/styles";

interface ScannedFood {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Props {
  onResult: (food: ScannedFood) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"scanning" | "found" | "error" | "manual">("scanning");
  const [food, setFood] = useState<ScannedFood | null>(null);
  const [editFood, setEditFood] = useState<ScannedFood | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const readerRef = useRef<unknown>(null);

  useEffect(() => {
    let stopped = false;

    async function start() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/library");
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        const devices = await reader.listVideoInputDevices();
        const backCamera = devices.find((d) => d.label.toLowerCase().includes("back")) ?? devices[0];
        if (!backCamera) { setStatus("manual"); return; }

        await reader.decodeFromVideoDevice(backCamera.deviceId, videoRef.current!, async (result, err) => {
          if (stopped) return;
          if (result) {
            stopped = true;
            (reader as { reset: () => void }).reset();
            await lookupBarcode(result.getText());
          }
          if (err && err.name !== "NotFoundException") {
            setErrorMsg("Camera error — enter manually below.");
            setStatus("manual");
          }
        });
      } catch {
        setErrorMsg("Camera unavailable — enter manually below.");
        setStatus("manual");
      }
    }

    start();
    return () => {
      stopped = true;
      if (readerRef.current) {
        (readerRef.current as { reset: () => void }).reset();
      }
    };
  }, []);

  async function lookupBarcode(barcode: string) {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
      const json = await res.json();
      if (json.status !== 1) throw new Error("Product not found");
      const { product } = json;
      const n = product.nutriments ?? {};
      const servingG = parseFloat(product.serving_quantity) || 100;
      const factor = servingG / 100;

      const found: ScannedFood = {
        name: product.product_name || "Unknown product",
        calories: Math.round((n["energy-kcal_100g"] ?? n["energy-kcal"] ?? 0) * factor),
        protein: Math.round(((n.proteins_100g ?? n.proteins ?? 0) * factor) * 10) / 10,
        carbs: Math.round(((n.carbohydrates_100g ?? n.carbohydrates ?? 0) * factor) * 10) / 10,
        fat: Math.round(((n.fat_100g ?? n.fat ?? 0) * factor) * 10) / 10,
      };
      setFood(found);
      setEditFood({ ...found });
      setStatus("found");
    } catch {
      setErrorMsg("Product not found in database.");
      setStatus("manual");
    }
  }

  function confirm() {
    if (editFood) onResult(editFood);
  }

  const ef = editFood;
  const setEf = (k: keyof ScannedFood) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditFood((f) => f ? { ...f, [k]: k === "name" ? e.target.value : parseFloat(e.target.value) || 0 } : f);

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600 }}>Scan barcode</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
          <X size={18} />
        </button>
      </div>

      {status === "scanning" && (
        <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
          <video ref={videoRef} style={{ width: "100%", display: "block", borderRadius: 8 }} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "70%", height: 2, background: "var(--accent)", opacity: 0.7 }} />
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
            Point camera at barcode
          </div>
        </div>
      )}

      {status === "found" && ef && (
        <div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#7fd494", marginBottom: 10 }}>Found! Confirm or adjust:</div>
          <input value={ef.name} onChange={setEf("name")} style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input value={ef[k]} onChange={setEf(k)} inputMode="decimal" style={{ ...inputStyle, padding: "8px 10px", fontSize: 14 }} />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={confirm} style={primaryBtnStyle}><Check size={14} /> Log it</button>
            <button onClick={() => { setStatus("scanning"); setFood(null); }} style={ghostBtnStyle}>Re-scan</button>
          </div>
        </div>
      )}

      {(status === "manual" || status === "error") && (
        <div>
          {errorMsg && <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#ff8a6a", marginBottom: 8 }}>{errorMsg}</div>}
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
            Use the manual entry form below instead.
          </div>
          <button onClick={onClose} style={ghostBtnStyle}>Close scanner</button>
        </div>
      )}
    </div>
  );
}
