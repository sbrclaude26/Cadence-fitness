import { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  flex: 1,
  background: "#101013",
  border: "1px solid #2a2a2e",
  borderRadius: 10,
  padding: "11px 12px",
  color: "var(--ink)",
  fontSize: 15,
  fontFamily: "var(--font-body)",
  outline: "none",
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
};

export const textareaStyle: CSSProperties = {
  width: "100%",
  background: "#101013",
  border: "1px solid #2a2a2e",
  borderRadius: 10,
  padding: "11px 12px",
  color: "var(--ink)",
  fontSize: 14,
  fontFamily: "var(--font-body)",
  outline: "none",
  resize: "vertical",
  boxSizing: "border-box",
};

export const primaryBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "var(--accent)",
  color: "#140a06",
  border: "none",
  borderRadius: 10,
  padding: "11px 16px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  whiteSpace: "nowrap",
};

export const ghostBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  background: "transparent",
  color: "var(--accent)",
  border: "1px solid var(--accent)",
  borderRadius: 10,
  padding: "9px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--font-body)",
};

export const checkboxStyle = (on: boolean): CSSProperties => ({
  width: 24,
  height: 24,
  borderRadius: 7,
  border: "1.5px solid " + (on ? "var(--accent)" : "#3a3a40"),
  background: on ? "var(--accent)" : "transparent",
  color: "#140a06",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  cursor: "pointer",
});

export const delBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#6a6a70",
  cursor: "pointer",
  padding: 2,
  display: "flex",
};
