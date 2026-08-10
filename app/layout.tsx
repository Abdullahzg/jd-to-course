import React from "react";
import type { Metadata } from "next";
import { Poppins, Inter, JetBrains_Mono } from "next/font/google";
import { BudgetBar } from "@/components/budget/budget-bar";
import { BudgetProvider } from "@/components/budget/budget-provider";
import { AuthProvider, Beacon } from "@/components/session";
import { PlannerProvider } from "@/components/planner/planner-store";
import "./globals.css";

// Poppins carries the display voice, Inter does the reading work, JetBrains
// sets every course code and numeral. Course codes are serial numbers, not
// words — "COMS W4995" is closer to a flight number than to prose — so setting
// them in mono is a decision the subject makes for us.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Job description \u2192 best course path",
  description:"Paste a job posting and the courses you have finished. A solver picks the classes that get you closest to that job while satisfying every degree rule, then shows you what classes cannot teach you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${poppins.variable} ${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {/* The whole app is one viewport-tall column: the money bar is a row in
            it, not an extra strip stacked on top. Stacking it above a
            100vh child made every page exactly one bar taller than the screen,
            which is why a survey that should never scroll, scrolled. */}
        <AuthProvider>
        <Beacon />
        <BudgetProvider>
          <div className="flex h-dvh flex-col overflow-hidden">
            <BudgetBar />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PlannerProvider>{children}</PlannerProvider>
            </div>
          </div>
        </BudgetProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
