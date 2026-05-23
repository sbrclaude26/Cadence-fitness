import { type LucideIcon } from "lucide-react";

export function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div style={{ paddingTop: 60, textAlign: "center", color: "var(--muted)" }}>
      <Icon size={34} style={{ color: "var(--accent)", margin: "0 auto" }} />
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 18,
          color: "var(--ink)",
          marginTop: 12,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 13.5,
          marginTop: 6,
          maxWidth: 260,
          margin: "6px auto 0",
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
    </div>
  );
}

export function EmptyMini({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--muted)",
        fontSize: 13,
        textAlign: "center",
        padding: "0 20px",
      }}
    >
      {text}
    </div>
  );
}
