import { Fragment } from "react";

function renderInline(text: string) {
  // Split on **bold** segments. Odd indices are bold.
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: "var(--ink)", fontWeight: 700 }}>
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

export function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div style={{ marginTop: 6 }}>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 15,
            lineHeight: 1.65,
            margin: "0 0 12px",
            color: "#d8d6cf",
          }}
        >
          {renderInline(p)}
        </p>
      ))}
    </div>
  );
}
