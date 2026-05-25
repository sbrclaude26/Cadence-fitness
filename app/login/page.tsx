"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode =
  | "signin"
  | "signup"
  | "verify-signup"
  | "forgot"
  | "verify-recovery"
  | "set-password";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  function reset(next: Mode) {
    setError("");
    setNotice("");
    setCode("");
    setMode(next);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNeedsPasswordSetup(false);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      if (error.message.toLowerCase().includes("invalid login credentials")) {
        setError("Wrong email or password.");
        setNeedsPasswordSetup(true);
      } else {
        setError(error.message);
      }
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    reset("verify-signup");
    setNotice(`We emailed a 6-digit code to ${email}.`);
  }

  async function handleVerifySignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "signup",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/today");
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    reset("verify-recovery");
    setNotice(`We emailed a 6-digit code to ${email}.`);
  }

  async function handleVerifyRecovery(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "recovery",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    reset("set-password");
    setPassword("");
    setNotice("Code accepted. Choose a new password.");
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/today");
    router.refresh();
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

      <div
        style={{
          width: "100%",
          background: "var(--card)",
          border: "1px solid #232327",
          borderRadius: 16,
          padding: 24,
        }}
      >
        {mode === "signin" && (
          <form onSubmit={handleSignIn}>
            <Title>Sign in</Title>
            <EmailInput value={email} onChange={setEmail} />
            <PasswordInput value={password} onChange={setPassword} />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Sign in" />
            {needsPasswordSetup && (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                If you used the email link before, you don&apos;t have a password yet.{" "}
                <LinkBtn onClick={() => reset("forgot")}>Set one now</LinkBtn>.
              </div>
            )}
            <Footer>
              <LinkBtn onClick={() => reset("forgot")}>Forgot password</LinkBtn>
              <LinkBtn onClick={() => reset("signup")}>Create account</LinkBtn>
            </Footer>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={handleSignUp}>
            <Title>Create account</Title>
            <EmailInput value={email} onChange={setEmail} />
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Password (min 8 characters)"
              minLength={8}
            />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Create account" />
            <Footer>
              <LinkBtn onClick={() => reset("signin")}>Have an account? Sign in</LinkBtn>
            </Footer>
          </form>
        )}

        {mode === "verify-signup" && (
          <form onSubmit={handleVerifySignup}>
            <Title>Enter code</Title>
            <CodeInput value={code} onChange={setCode} />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Verify and sign in" />
            <Footer>
              <LinkBtn onClick={() => reset("signin")}>Back to sign in</LinkBtn>
            </Footer>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot}>
            <Title>Reset password</Title>
            <p style={hintStyle}>Enter your email and we&apos;ll send a 6-digit code.</p>
            <EmailInput value={email} onChange={setEmail} />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Send code" />
            <Footer>
              <LinkBtn onClick={() => reset("signin")}>Back to sign in</LinkBtn>
            </Footer>
          </form>
        )}

        {mode === "verify-recovery" && (
          <form onSubmit={handleVerifyRecovery}>
            <Title>Enter code</Title>
            <CodeInput value={code} onChange={setCode} />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Verify code" />
            <Footer>
              <LinkBtn onClick={() => reset("signin")}>Back to sign in</LinkBtn>
            </Footer>
          </form>
        )}

        {mode === "set-password" && (
          <form onSubmit={handleSetPassword}>
            <Title>Set new password</Title>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="New password (min 8 characters)"
              minLength={8}
            />
            <Notice value={notice} />
            <ErrorMsg value={error} />
            <PrimaryButton loading={loading} label="Save and sign in" />
          </form>
        )}
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
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
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--muted)",
  marginBottom: 12,
  lineHeight: 1.5,
};

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, color: "var(--ink)" }}>
      {children}
    </div>
  );
}

function EmailInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="email"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="you@example.com"
      required
      autoComplete="email"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      inputMode="email"
      style={fieldStyle}
    />
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minLength?: number;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required
      autoComplete="current-password"
      minLength={minLength}
      style={fieldStyle}
    />
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="123456"
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      style={{
        ...fieldStyle,
        fontSize: 22,
        letterSpacing: "0.4em",
        textAlign: "center",
        fontFamily: "var(--font-display)",
      }}
    />
  );
}

function ErrorMsg({ value }: { value: string }) {
  if (!value) return null;
  return <div style={{ color: "#ff8a6a", fontSize: 13, marginBottom: 10 }}>{value}</div>;
}

function Notice({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
      {value}
    </div>
  );
}

function PrimaryButton({ loading, label }: { loading: boolean; label: string }) {
  return (
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
      {loading ? "Working…" : label}
    </button>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        display: "flex",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function LinkBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        color: "var(--accent)",
        cursor: "pointer",
        padding: 0,
        fontSize: 13,
        fontFamily: "var(--font-body)",
        textDecoration: "underline",
      }}
    >
      {children}
    </button>
  );
}
