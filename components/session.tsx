"use client";

import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

/**
 * The measurement the admin page reads. Two kinds of event and no more:
 * a pageview per route, and a click on anything that carries data-track.
 * sendBeacon so a navigation away does not eat the event.
 */
export function Beacon() {
  const pathname = usePathname();
  useEffect(() => {
    const send = (name: string, meta?: unknown) => {
      try {
        navigator.sendBeacon("/api/track", new Blob([JSON.stringify({ name, meta })], { type: "application/json" }));
      } catch { /* an unmeasured click is still a click */ }
    };
    send("pageview", { path: pathname });
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.("[data-track]");
      if (el) send("click", { id: el.getAttribute("data-track"), path: pathname });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);
  return null;
}
