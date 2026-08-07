import type { School, Course, Program, StudentState } from "@/lib/types";
import { COLUMBIA } from "./columbia";
import { BMCC } from "./bmcc";

export const SCHOOLS: School[] = [COLUMBIA, BMCC];

export function getSchool(id: string): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}

export function getProgram(schoolId: string, programId: string): Program | undefined {
  return getSchool(schoolId)?.programs.find((p) => p.id === programId);
}

export function courseIndex(school: School): Map<string, Course> {
  return new Map(school.courses.map((c) => [c.id, c]));
}

// ─────────────────────────── the demo scenario (§12) ────────────────────────
// One persona. One click to a solved board. A judge will not paste a JD.

export const DEMO_JD_ML = `Machine Learning Engineer, New Grad

We build and ship ML systems that serve millions of requests a day.

What you'll do
- Train and fine-tune deep learning models in PyTorch
- Build data pipelines that feed training at scale
- Deploy models behind low-latency serving infrastructure on Kubernetes
- Work with distributed training across many GPUs
- Write production Python and collaborate through code review

What we're looking for
- Strong foundations in machine learning and deep learning
- Experience with PyTorch or a comparable framework
- Comfortable with Linux, Docker and containers
- Solid understanding of distributed systems and how they fail
- Working knowledge of SQL and data modeling
- 3 years of production experience shipping ML systems at scale
- Track record of owning a service end to end in production`;

export const DEMO_JD_BACKEND = `Backend Engineer, Platform

You'll own the services that everything else at the company is built on.

Responsibilities
- Design and operate distributed services in Go
- Own database schema design and query performance in Postgres
- Build and maintain CI/CD pipelines
- Run services on Kubernetes with meaningful monitoring and alerting
- Participate in on-call rotation and incident review

Requirements
- Strong computer networks and operating systems fundamentals
- Experience with SQL and relational data modeling
- Familiarity with containers and cloud deployment
- Comfortable writing C or Go close to the metal
- 5+ years operating production systems at scale`;

export const DEMO_JD_SECURITY = `Security Engineer, Product Security

Help us keep a platform used by millions safe.

What you'll do
- Threat model new services before they ship
- Review code for security vulnerabilities
- Build tooling that makes the secure path the easy path
- Work across cryptography, authentication and access control

What we look for
- Foundations in computer security and applied cryptography
- Strong operating systems and computer networks knowledge
- Ability to read and write C
- Experience running a bug bounty programme`;

export const PRELOADED_JDS = [
  { id: "ml", label: "ML Engineer, New Grad", body: DEMO_JD_ML },
  { id: "backend", label: "Backend Engineer, Platform", body: DEMO_JD_BACKEND },
  { id: "security", label: "Security Engineer", body: DEMO_JD_SECURITY },
];

/**
 * §12 — "A junior CS major at Columbia with 62 credits done, targeting ML
 * engineering roles, who has 5 terms of slack left and has been choosing
 * electives at random."
 */
export const DEMO_STUDENT: StudentState = {
  program: "COLUMBIA:CS_BA",
  completed: [
    "COLUMBIA:COMSW1004",
    "COLUMBIA:COMSW3134",
    "COLUMBIA:COMSW3203",
    "COLUMBIA:MATHUN1201",
  ],
  startTerm: "FA",
  horizonTerms: 4,
  locked: [],
  excluded: [],
  completedCredits: 62,
};

export const DEMO_STUDENT_BMCC: StudentState = {
  program: "BMCC:CS_AS",
  completed: ["BMCC:ENG101", "BMCC:CSC101", "BMCC:MAT206"],
  startTerm: "FA",
  horizonTerms: 4,
  locked: [],
  excluded: [],
  completedCredits: 13,
};

/** Term labels for a horizon starting at `startTerm` in `startYear`. */
export function termLabels(startTerm: "FA" | "SP" | "SU", startYear: number, n: number): string[] {
  const out: string[] = [];
  let t = startTerm;
  let y = startYear;
  for (let i = 0; i < n; i++) {
    out.push(`${t === "FA" ? "FALL" : t === "SP" ? "SPRING" : "SUMMER"} ${String(y).slice(2)}`);
    if (t === "FA") {
      t = "SP";
      y += 1;
    } else if (t === "SP") {
      t = "FA";
    } else {
      t = "FA";
    }
  }
  return out;
}

/** The concrete term type (FA/SP/SU) at each index of the horizon. */
export function termKinds(startTerm: "FA" | "SP" | "SU", n: number, allowSummer = false): ("FA" | "SP" | "SU")[] {
  const out: ("FA" | "SP" | "SU")[] = [];
  let t = startTerm;
  for (let i = 0; i < n; i++) {
    out.push(t);
    if (allowSummer && t === "SP") t = "SU";
    else if (t === "FA") t = "SP";
    else t = "FA";
  }
  return out;
}
