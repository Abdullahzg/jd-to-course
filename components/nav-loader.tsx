"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The thin bar that answers "did my click do anything".
 *
 * Every internal link click starts it; arriving anywhere stops it. Pages
 * that navigate in code fire the carpa-nav event for the same treatment.
 * Without this, a click on a slow route left the screen frozen mid thought,
 * and frozen reads as broken no matter how fast the server actually was.
 */
export function NavLoader() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const failsafe = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBusy(false);
    if (failsafe.current) clearTimeout(failsafe.current);
  }, [pathname]);

  useEffect(() => {
    const start = () => {
      setBusy(true);
      if (failsafe.current) clearTimeout(failsafe.current);
      // A bar that never ends is worse than none.
      failsafe.current = setTimeout(() => setBusy(false), 15000);
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      const to = new URL(href, location.href);
      if (to.pathname === location.pathname) return;
      start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("carpa-nav", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("carpa-nav", start);
      if (failsafe.current) clearTimeout(failsafe.current);
    };
  }, []);

  if (!busy) return null;
  return (
    <div aria-hidden className="fixed inset-x-0 top-0 z-[120] h-0.5 overflow-hidden bg-transparent">
      <div className="h-full w-1/3 rounded-full bg-foreground [animation:carpa-bar_1.1s_ease-in-out_infinite]" />
    </div>
  );
}
