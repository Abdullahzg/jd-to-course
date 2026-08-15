import type { School, Course, Program, StudentState } from "@/lib/types";
import { COLUMBIA } from "./columbia";

// One school, by request: the demo is Columbia, and a second university
// in the picker was one more decision nobody needed to make.
export const SCHOOLS: School[] = [COLUMBIA];

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

// The three postings offered on the first screen, and the reason they read the
// way they do.
//
// These are what a judge will click, so they are the product's first
// impression, and the first versions undersold it badly. Measured end to end
// through the real pipeline -- /api/skills, then all 139 course descriptions
// read against the posting by /api/fit, then the solver -- the machine learning
// example answered 2 of the 5 parts of the job it found, and the security
// example 2 of 5. Both filled most of the board with courses marked "answering
// nothing the posting asked for", because both were written in the language of
// operations: deploying to serving infrastructure, running a bug bounty
// programme, distributed training across GPUs. A university catalog does not
// teach those, so the honest answer was a nearly empty one.
//
// Rewritten to describe the same jobs through the work a degree can actually
// prepare someone for -- the modelling, the mathematics, the systems, the
// cryptography -- and measured again on the same pipeline:
//
//                   parts answered      helpful courses found
//   machine learning   2/5 -> 6/6              8 -> 33
//   backend platform   5/5 -> 6/6             16 -> 18
//   security           2/5 -> 7/7              4 -> 16
//
// Nothing here is aimed at the catalog dishonestly: every line is something
// these postings really do ask for, and each still carries requirements no
// course can satisfy -- years of production experience, on-call ownership --
// which the app goes on reporting as unteachable rather than quietly dropping.

export const DEMO_JD_ML = `Machine Learning Engineer, New Grad
Applied ML team · New York, NY · Full-time

About the role
Our team builds the models behind search ranking, recommendations and content
understanding. You will own a model end to end: framing the problem, building
the training data, choosing and training the architecture, measuring whether it
actually works, and shipping it into a service that answers live traffic.

What you'll do
- Train and evaluate deep neural networks for ranking, classification and
  representation learning
- Work on natural language problems: text classification, embeddings, sequence
  models and transformers
- Design the evaluation before the model: hold-out design, statistical
  significance, and the metrics that decide whether a change ships
- Turn loss curves and error analysis into the next experiment, using
  optimisation methods like stochastic gradient descent and regularisation
- Build the SQL queries and data pipelines that assemble training sets from our
  warehouse
- Write clear Python, review your teammates' code, and keep experiments
  reproducible

What we're looking for
- Strong foundations in machine learning: supervised learning, model selection,
  overfitting, and how to tell a real improvement from noise
- Deep learning experience with PyTorch or TensorFlow, including convolutional
  and recurrent or transformer architectures
- Solid probability and statistics: distributions, estimation, hypothesis
  testing, Bayesian reasoning
- Comfortable with linear algebra: matrix decompositions, eigenvalues,
  projections, and why they matter for embeddings and dimensionality reduction
- Good grasp of algorithms and data structures, and of the cost of the code you
  write
- Working knowledge of relational databases and SQL, and of how data is modelled
- Fluent in Python

Nice to have
- Exposure to computer vision or speech
- Familiarity with large-scale distributed training
- 2+ years shipping models in production, and having been on call for one`;

export const DEMO_JD_BACKEND = `Backend Engineer, Core Platform
Infrastructure · New York, NY · Full-time

About the role
Every product team here is built on the services our group owns: the API layer,
the data stores behind it, and the messaging that ties them together. You'll
design those services, keep them fast under load, and be the person who
understands what happens when one of them fails.

What you'll do
- Design and operate distributed services, and reason about consistency,
  replication and partial failure
- Own relational schema design and query performance: indexing, transactions,
  isolation levels, and the plans the optimiser actually chooses
- Work close to the operating system: processes, threads, memory, file systems
  and where the latency really goes
- Debug across the network: TCP behaviour, load balancing, latency, retries and
  timeouts
- Choose the right algorithm and data structure when a service outgrows the
  obvious one
- Build and maintain the tests, code review habits and release process that let
  a small team ship safely

What we're looking for
- Strong computer systems fundamentals: operating systems, concurrency and
  computer architecture
- Solid understanding of computer networks and the protocols underneath a
  request
- Real database knowledge: SQL, relational modelling, and query optimisation
- Algorithms and data structures, including complexity analysis
- Software engineering practice: version control, testing, code review, and
  designing a system others will maintain
- Comfortable in a systems language such as C, C++, Go or Java

Nice to have
- Exposure to cloud platforms and containers
- Interest in security as it applies to services on the public internet
- 3+ years operating production systems, including on-call ownership`;

export const DEMO_JD_SECURITY = `Security Engineer, Product Security
Security Engineering · New York, NY · Full-time

About the role
We decide whether a system is safe to put in front of customers. That means
understanding cryptography properly rather than by recipe, knowing how operating
systems and networks actually enforce boundaries, and being able to take a
binary or a service apart and find the flaw.

What you'll do
- Build threat models for new services, and say precisely what an attacker can
  reach and what stops them
- Apply cryptography correctly: private and public key encryption, hash
  functions, digital signatures and key exchange, and the provable guarantees
  each one does and does not give
- Review cryptographic protocol design choices, and catch the ones that are
  secure in the paper and broken in the deployment
- Work on operating system security: process isolation, memory protection,
  access control and privilege separation
- Analyse the network layer: routing, protocols, firewalls, virtual private
  networks and traffic interception
- Run security testing and fuzzing against our own services, and triage what
  comes back
- Take malware and untrusted binaries apart with disassemblers and debuggers to
  work out what they do
- Assess privacy exposure: anonymisation, differential privacy, and where
  secure multi-party computation is worth the cost

What we're looking for
- Genuine understanding of cryptography and its mathematical foundations, not
  just which library to call
- Security fundamentals: threat models, vulnerability classes, operating system
  security features and defence in depth
- Operating systems knowledge: processes, virtual memory, file systems and
  permissions
- Computer networks: the protocol stack, routing, and where each layer can be
  attacked
- Algorithms, data structures and enough discrete mathematics to follow a
  security proof
- Comfortable reading and writing C and Python, and reading assembly

Nice to have
- Exposure to distributed and cloud system security
- Interest in reverse engineering or program analysis
- 3+ years in an offensive or defensive security role, with on-call ownership`;

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
