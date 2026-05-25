"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check, Camera } from "lucide-react";
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

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(image: HTMLVideoElement | HTMLImageElement): Promise<Array<{ rawValue: string }>>;
  static getSupportedFormats(): Promise<string[]>;
}

export function BarcodeScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"scanning" | "found" | "error">("scanning");
  const [editFood, setEditFood] = useState<ScannedFood | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [usePhoto, setUsePhoto] = useState(false);

  useEffect(() => {
    let active = true;

    async function startVideo() {
      if (!("BarcodeDetector" in window)) {
        // BarcodeDetector not available — fall back to photo mode silently
        setUsePhoto(true);
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        // Don't await play() — just call it and let the video render
        video.play().catch(() => {});

        const formats = await BarcodeDetector.getSupportedFormats();
        const detector = new BarcodeDetector({ formats });

        function tick() {
          if (!active) return;
          if (video!.readyState >= 2 && video!.videoWidth > 0) {
            detector.detect(video!).then((results) => {
              if (results.length > 0 && active) {
                active = false;
                stop();
                lookupBarcode(results[0].rawValue);
              }
            }).catch(() => {});
          }
          rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (!active) return;
        const name = (e as { name?: string }).name ?? "";
        setErrorMsg(name === "NotAllowedError" ? "Camera permission denied." : "Camera unavailable.");
        setUsePhoto(true);
      }
    }

    function stop() {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    startVideo();
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let barcode: string | null = null;

      if ("BarcodeDetector" in window) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(r => { img.onload = r; });
        const formats = await BarcodeDetector.getSupportedFormats();
        const detector = new BarcodeDetector({ formats });
        const results = await detector.detect(img as unknown as HTMLImageElement);
        if (results.length) barcode = results[0].rawValue;
      }

      if (!barcode) {
        // Fallback: use html5-qrcode scanFile (works without BarcodeDetector)
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("cadence-photo-scanner", {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });
        barcode = await scanner.scanFile(file, false);
      }

      if (!barcode) throw new Error("No barcode found in photo. Try again with better lighting.");
      await lookupBarcode(barcode);
    } catch (err) {
      setErrorMsg((err as Error).message ?? "Could not read barcode. Try again closer to the barcode.");
      setStatus("error");
    }
  }

  async function lookupBarcode(barcode: string) {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
      const json = await res.json();
      if (json.status !== 1) throw new Error("Product not found in database.");
      const { product } = json;
      const n = product.nutriments ?? {};
      const servingG = parseFloat(product.serving_quantity) || 100;
      const factor = servingG / 100;
      setEditFood({
        name: product.product_name || "Unknown product",
        calories: Math.round((n["energy-kcal_100g"] ?? n["energy-kcal"] ?? 0) * factor),
        protein: Math.round(((n.proteins_100g ?? n.proteins ?? 0) * factor) * 10) / 10,
        carbs: Math.round(((n.carbohydrates_100g ?? n.carbohydrates ?? 0) * factor) * 10) / 10,
        fat: Math.round(((n.fat_100g ?? n.fat ?? 0) * factor) * 10) / 10,
      });
      setStatus("found");
    } catch (err) {
      setErrorMsg((err as Error).message ?? "Product not found.");
      setStatus("error");
    }
  }

  const setEf = (k: keyof ScannedFood) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditFood(f => f ? { ...f, [k]: k === "name" ? e.target.value : parseFloat(e.target.value) || 0 } : f);

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600 }}>Scan barcode</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}>
          <X size={18} />
        </button>
      </div>

      {/* Live video scanner */}
      {status === "scanning" && !usePhoto && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", borderRadius: 8, display: "block", marginBottom: 8, background: "#111" }}
          />
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", textAlign: "center", marginBottom: 8 }}>
            Point camera at barcode
          </div>
          <button onClick={() => setUsePhoto(true)} style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", fontSize: 12 }}>
            <Camera size={13} /> Take photo instead
          </button>
        </>
      )}

      {/* Photo fallback */}
      {status === "scanning" && usePhoto && (
        <>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
            {errorMsg || "Take a photo of the barcode to scan it."}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={handlePhotoCapture}
          />
          <button onClick={() => fileRef.current?.click()} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}>
            <Camera size={15} /> Open camera
          </button>
          <div id="cadence-photo-scanner" style={{ display: "none" }} />
        </>
      )}

      {/* Found */}
      {status === "found" && editFood && (
        <div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#7fd494", marginBottom: 10 }}>Found! Confirm or adjust:</div>
          <input value={editFood.name} onChange={setEf("name")} style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input value={editFood[k]} onChange={setEf(k)} inputMode="decimal" style={{ ...inputStyle, padding: "8px 10px", fontSize: 14 }} />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => editFood && onResult(editFood)} style={primaryBtnStyle}><Check size={14} /> Log it</button>
            <button onClick={() => { setEditFood(null); setStatus("scanning"); }} style={ghostBtnStyle}>Re-scan</button>
          </div>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div>
          {errorMsg && <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#ff8a6a", marginBottom: 10 }}>{errorMsg}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setStatus("scanning"); setErrorMsg(""); setUsePhoto(true); }} style={ghostBtnStyle}>Try again</button>
            <button onClick={onClose} style={ghostBtnStyle}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
