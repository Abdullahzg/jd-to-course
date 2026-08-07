/**
 * Skill vocabulary reconciliation.
 *
 * A job posting says "Docker"; a course description says "containers". A
 * posting says "GPU computing"; a syllabus says "GPU acceleration". Matching
 * those on exact string equality pushes them into the "coursework cannot give
 * you" bucket — which is wrong, and worse than wrong, because that bucket is
 * the most important claim the product makes. Diluting it with vocabulary
 * mismatches is how it stops meaning anything.
 *
 * So: an explicit, hand-written alias table. Deliberately NOT fuzzy matching
 * and NOT a model call. Fuzzy matching over-claims — "computer vision" and
 * "computer networks" share two thirds of their tokens — and a model asked
 * "does this course cover this skill?" is a model deciding, which §5 forbids.
 * A table is auditable: every equivalence below is a claim a human made and
 * can be argued with.
 *
 * The rule for adding an entry: the two phrasings must name the same
 * capability, such that the course's own evidence sentence would satisfy a
 * hiring manager who asked for the posting's term. If it needs a paragraph of
 * justification, it does not belong here.
 */

/** canonical catalog skill -> phrasings a job posting might use for it */
const ALIASES: Record<string, string[]> = {
  Containers: ["docker", "containerisation", "containerization", "container runtime"],
  Kubernetes: ["k8s", "kubernetes orchestration", "container orchestration"],
  Python: ["python3", "production python", "python programming"],
  SQL: ["postgres", "postgresql", "mysql", "relational databases", "sql queries"],
  Databases: ["database design", "rdbms", "relational database design"],
  "GPU programming": ["gpu computing", "gpus", "cuda", "gpu acceleration", "gpu"],
  "Distributed systems": ["distributed computing", "distributed services"],
  "Distributed training": ["multi-gpu training", "data parallelism", "model parallelism"],
  "Machine learning": ["ml", "classical machine learning", "predictive modelling", "predictive modeling"],
  "Deep learning": ["neural networks", "deep neural networks", "dnn"],
  PyTorch: ["torch", "pytorch lightning"],
  "Data engineering": ["data pipelines", "etl", "data pipeline", "batch processing"],
  "ML pipelines": ["ml pipeline", "training pipelines", "mlops"],
  "Model serving": ["model deployment", "inference serving", "low-latency serving", "model inference"],
  "Computer networks": ["networking", "network fundamentals"],
  "Operating systems": ["os fundamentals", "systems fundamentals"],
  Linux: ["unix", "linux/unix", "unix/linux"],
  "CI/CD": ["continuous integration", "continuous deployment", "ci", "cd pipelines", "build pipelines"],
  "Cloud deployment": ["cloud", "aws", "gcp", "azure", "cloud infrastructure"],
  Algorithms: ["algorithm design", "data structures and algorithms"],
  "Data structures": ["data structures and algorithms"],
  Security: ["application security", "product security", "appsec"],
  Concurrency: ["multithreading", "parallel programming", "threading"],
  Testing: ["unit testing", "test automation", "automated testing"],
  Git: ["version control", "source control"],
  "Software architecture": ["system design", "architecture"],
  Microservices: ["service-oriented architecture", "soa"],
  Go: ["golang"],
  "C++": ["cpp"],
  NLP: ["natural language processing", "language models", "llms"],
  "Computer vision": ["cv", "image processing", "vision"],
  Statistics: ["statistical analysis", "stats"],
  Probability: ["probability theory"],
  "Linear algebra": ["matrices", "linear algebra fundamentals"],
  Monitoring: ["observability", "alerting", "metrics and monitoring"],
  Scalability: ["scaling", "at scale systems", "high scale"],
  Spark: ["apache spark"],
  Java: ["jvm"],
  JavaScript: ["js", "typescript"],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, phrasings] of Object.entries(ALIASES)) {
  LOOKUP.set(canonical.toLowerCase(), canonical.toLowerCase());
  for (const p of phrasings) LOOKUP.set(p.toLowerCase(), canonical.toLowerCase());
}

/**
 * Fold a skill string to the key the solver matches on. Both the posting's
 * words and the catalog's words go through this, so they meet in the middle.
 */
export function skillKey(s: string): string {
  const n = s.trim().toLowerCase().replace(/\s+/g, " ");
  return LOOKUP.get(n) ?? n;
}

/** True when the posting's term and the catalog's term name the same thing. */
export function sameSkill(a: string, b: string): boolean {
  return skillKey(a) === skillKey(b);
}

/**
 * Whether a phrase describes something a classroom cannot supply — years on
 * the job, having shipped a thing, being on call. These belong in the third
 * coverage bucket by their nature, not because we failed to find a course.
 */
const EXPERIENCE = [
  /\b\d+\+?\s*(?:-|\s)?\s*years?\b/i,
  /\byears? of\b/i, /\bexperience\b/i, /\bproduction\b/i, /\bat scale\b/i,
  /\bshipped\b/i, /\bshipping\b/i, /\bon-?call\b/i, /\bownership\b/i,
  /\bowning\b/i, /\bown(?:ed)? a\b/i, /\bmentor/i, /\bincident\b/i,
  /\btrack record\b/i, /\bend[- ]to[- ]end\b/i, /\bcross-functional\b/i,
  /\bstakeholder/i, /\bhiring\b/i, /\bled a team\b/i, /\bleadership\b/i,
];

export function isExperienceRequirement(skill: string): boolean {
  return EXPERIENCE.some((r) => r.test(skill));
}
