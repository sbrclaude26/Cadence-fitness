"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Sparkles, Plus, TrendingUp, Target, LogOut, RefreshCw } from "lucide-react";

const TABS = [
  { id: "today", label: "Today", icon: CalendarClock, href: "/today" },
  { id: "plan", label: "Plan", icon: Sparkles, href: "/plan" },
  { id: "log", label: "Log", icon: Plus, href: "/log" },
  { id: "trends", label: "Trends", icon: TrendingUp, href: "/trends" },
  { id: "goals", label: "Goals", icon: Target, href: "/goals" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [refreshing, setRefreshing] = useState(false);

  async function hardRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
    } catch {
      // swallow — reload below will still happen
    }
    window.location.reload();
  }

  return (
    <div
      style={{
        maxWidth: 460,
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--font-body)",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "calc(22px + env(safe-area-inset-top, 0px))",
          paddingRight: 18,
          paddingBottom: 16,
          paddingLeft: 18,
          borderBottom: "1px solid #1f1f23",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
              fontFamily: "var(--font-display)",
            }}
          >
            Cadence
          </div>
          <div
            id="header-subtitle"
            style={{ fontSize: 13, color: "var(--muted)", letterSpacing: "0.04em" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            id="progress-ring"
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              border: "2px solid var(--accent)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              id="progress-pct"
              style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)", fontFamily: "var(--font-display)" }}
            >
              —
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)" }}>TO GOAL</div>
          </div>
          <button
            type="button"
            onClick={hardRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
            style={{
              background: "transparent",
              border: "none",
              color: "#6a6a70",
              cursor: refreshing ? "default" : "pointer",
              padding: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            <RefreshCw
              size={18}
              style={{
                animation: refreshing ? "cadence-spin 0.9s linear infinite" : undefined,
              }}
            />
          </button>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              style={{
                background: "transparent",
                border: "none",
                color: "#6a6a70",
                cursor: "pointer",
                padding: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LogOut size={18} />
            </button>
          </form>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          paddingLeft: 18,
          paddingRight: 18,
          paddingBottom: "calc(110px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </div>

      {/* Tab bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 460,
          background: "rgba(16,16,19,0.92)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid #1f1f23",
          display: "flex",
          paddingTop: 8,
          paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
          zIndex: 50,
        }}
      >
        {TABS.map(({ id, label, icon: Icon, href }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={id}
              href={href}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                color: active ? "var(--accent)" : "#5a5a60",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                gap: 3,
                paddingTop: 4,
              }}
            >
              <Icon size={22} />
              <span style={{ fontSize: 11, marginTop: 2 }}>{label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
