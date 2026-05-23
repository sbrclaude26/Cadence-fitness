"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div
      style={{
        maxWidth: 460,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--ink)",
            fontFamily: "var(--font-display)",
            marginBottom: 6,
          }}
        >
          Cadence
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.04em" }}>
          YOUR ADAPTIVE FITNESS COACH
        </div>
      </div>

      {sent ? (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--accent)",
            borderRadius: 16,
            padding: 24,
            textAlign: "center",
            width: "100%",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Check your email</div>
          <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
            We sent a magic link to <strong style={{ color: "var(--ink)" }}>{email}</strong>. Tap
            it to sign in — no password needed.
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{
            width: "100%",
            background: "var(--card)",
            border: "1px solid #232327",
            borderRadius: 16,
            padding: 24,
          }}
        >
          <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
            Enter your email to receive a sign-in link.
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={{
              width: "100%",
              background: "#101013",
              border: "1px solid #2a2a2e",
              borderRadius: 10,
              padding: "12px 14px",
              color: "var(--ink)",
              fontSize: 15,
              fontFamily: "var(--font-body)",
              outline: "none",
              marginBottom: 12,
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ color: "#ff8a6a", fontSize: 13, marginBottom: 10 }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "var(--accent)",
              color: "#140a06",
              border: "none",
              borderRadius: 10,
              padding: "12px 16px",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </div>
  );
}
