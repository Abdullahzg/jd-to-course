"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

/**
 * The planner spends real model money and saves real state; both belong to
 * an account. Signed out, every gated page walks you to the sign in door
 * instead of half working.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/home");
  }, [status, router]);
  if (status !== "authenticated") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
