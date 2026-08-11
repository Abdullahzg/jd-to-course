import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { upsertUser, logEvent } from "@/lib/db";

/**
 * Two doors, one session shape.
 *
 * Google is the real door: it also carries the gmail.readonly scope, so the
 * same consent that signs someone in lets the tracker read their application
 * emails, one tab, one authorize click. The demo door exists because the
 * Google client id is configured per deployment and a judge at a table
 * should never be blocked from the product by someone else's env file.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? "dev-only-secret-set-AUTH_SECRET-in-production",
  session: { strategy: "jwt" },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID
      ? [Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
          // Basic scopes only at sign in. gmail.readonly is a RESTRICTED
          // scope: while the app is unverified, Google blocks it for anyone
          // not hand listed as a test user, which walled the whole product
          // off behind a list. Sign in now asks for nothing Google gates, so
          // every Google account on earth can enter; the Gmail scope is
          // requested separately, by the Connect Gmail button, only from
          // people who choose the OAuth route.
          authorization: {
            params: { scope: "openid email profile", prompt: "select_account" },
          },
        })]
      : []),
    Credentials({
      id: "demo",
      name: "Demo",
      credentials: {
        name: { label: "Your name", type: "text" },
        email: { label: "Email", type: "email" },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const name = String(creds?.name ?? "").trim();
        if (!email.includes("@") || !name) return null;
        const id = await upsertUser({ email, name });
        return { id, email, name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      if (user?.email) {
        token.uid = await upsertUser({ email: user.email, name: user.name, image: user.image });
        await logEvent(token.uid as string, "login", { provider: account?.provider ?? "demo" });
      }
      // The Gmail token rides in the JWT so the scan route can read mail
      // without a token table. Short lived by design; a stale token surfaces
      // as "reconnect Google" rather than as silent staleness.
      if (account?.access_token) token.gmail = account.access_token;
      if (account?.refresh_token) token.gmailRefresh = account.refresh_token;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.uid as string;
        (session as { gmailConnected?: boolean }).gmailConnected = Boolean(token.gmail);
      }
      return session;
    },
  },
});
