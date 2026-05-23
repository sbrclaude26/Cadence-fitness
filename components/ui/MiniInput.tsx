"use client";

export function MiniInput({
  label,
  def,
  val,
  onChange,
}: {
  label: string;
  def: string | number | undefined;
  val: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ flex: 1 }}>
      <input
        value={val}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${def ?? ""}`}
        inputMode="decimal"
        style={{
          width: "100%",
          background: "#101013",
          border: "1px solid #2a2a2e",
          borderRadius: 10,
          padding: "9px 10px",
          color: "var(--ink)",
          fontSize: 14,
          fontFamily: "var(--font-body)",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 9.5,
          color: "var(--muted)",
          textAlign: "center",
          marginTop: 2,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
    </div>
  );
}
