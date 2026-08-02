"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared client for background cycle builds.
//
// A build is a multi-minute Claude call. It used to run inside the request the
// phone held open, so the athlete was pinned to a spinner and backgrounding the
// app lost the result. Now the server records the build, returns immediately,
// and keeps generating; this hook starts builds and polls for the outcome.
//
// Both the Today tab (first plan / start next cycle) and the Plan tab (rebuild,
// plan ahead) use it so the behaviour is identical wherever a build starts.

export interface PlanBuildStatus {
  id: string;
  status: "building" | "done" | "error";
  mode: "current" | "queued";
  error: string | null;
}

export interface StartBuildOptions {
  mode: "current" | "queued";
  userNotes?: string;
  noAdjustments?: boolean;
  startDate?: string;
}

const POLL_MS = 5000;
const POLL_RETRY_MS = 8000;

export function usePlanBuild(onFinished?: (build: PlanBuildStatus) => void) {
  const [building, setBuilding] = useState(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  // Completed builds are acted on once — otherwise every later mount inside
  // the status window would re-fire the caller's refresh.
  const handledRef = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch("/api/plan/build", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        const build = json?.build as PlanBuildStatus | null;

        if (build?.status === "building") {
          setBuilding(true);
          setElapsedS(Math.round((json.elapsedMs ?? 0) / 1000));
          timer = setTimeout(poll, POLL_MS);
          return;
        }

        setBuilding(false);
        if (!build || handledRef.current === build.id) return;
        handledRef.current = build.id;
        if (build.status === "error") setError(build.error || "The build failed. Try again.");
        onFinishedRef.current?.(build);
      } catch {
        // Transient failure (phone asleep, tab backgrounded, offline) — keep
        // polling instead of declaring the build dead.
        if (!cancelled) timer = setTimeout(poll, POLL_RETRY_MS);
      }
    }

    poll();
    // Re-check the moment the app returns to the foreground so coming back to
    // a finished build doesn't wait for the next tick.
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [building]);

  const startBuild = useCallback(async (opts: StartBuildOptions) => {
    setStarting(true);
    setError("");
    try {
      const body: Record<string, unknown> = { mode: opts.mode, background: true };
      const notes = (opts.userNotes ?? "").trim();
      if (notes.length > 0) body.userNotes = notes;
      if (opts.noAdjustments) body.noAdjustments = true;
      if (opts.startDate) body.startDate = opts.startDate;

      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // Non-JSON bodies (gateway errors) make res.json() throw WebKit's
      // cryptic "The string did not match the expected pattern."
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        throw new Error(json?.error || `Couldn't start the build (${res.status}). Give it a minute and try again.`);
      }
      setBuilding(true); // kicks the poller
      setElapsedS(0);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  return { building, elapsedS, error, setError, starting, startBuild };
}
