"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CarpaMark } from "@/components/carpa-mark";

/**
 * Where a failed or cancelled sign in lands. The most common visitor here
 * pressed "Cancel" on Google's consent screen, which is a decision, not an
 * error, and the page that used to meet them said "server error" in grey
 * monospace. Now it says what happened and offers the door again.
 */
function Body() {
  const code = useSearchParams().get("error") ?? "";
  const cancelled = ["AccessDenied", "OAuthCallbackError", "Callback"].includes(code);
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-center">
        <CarpaMark className="mx-auto h-9 w-9 rounded-lg" />
        <h1 className="mt-3 font-display text-lg font-semibold">
          {cancelled ? "No harm done" : "That sign in did not go through"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {cancelled
            ? "You cancelled on Google's screen, so nothing was shared and nothing was created. Sign in whenever you are ready; it takes 15 seconds."
            : "Something between Google and us dropped the handshake. It is not your fault, and trying again usually just works."}
        </p>
        <Link href="/home" data-track="auth_error_retry"
              className="mt-4 inline-block rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-background">
          Back to sign in
        </Link>
        <Link href="/" className="mt-2 block text-xs text-muted-foreground underline underline-offset-2">
          or the front page
        </Link>
      </div>
    </main>
  );
}

export default function AuthError() {
  return <Suspense fallback={null}><Body /></Suspense>;
}
