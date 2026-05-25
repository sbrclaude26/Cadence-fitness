"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthStateSync() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        router.refresh();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router]);
  return null;
}
