"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearSnapshots } from "@/lib/snapshotCache";

export function AuthStateSync() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Cached tab state belongs to the signed-in account — drop it before the
      // next one can see it.
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") clearSnapshots();
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        router.refresh();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router]);
  return null;
}
