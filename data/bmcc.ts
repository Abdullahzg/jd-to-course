import type { School, Course, Source } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// BOROUGH OF MANHATTAN COMMUNITY COLLEGE (CUNY) — Computer Science AS.
//
// BUILD_SPEC §6.2: "Pick a structurally different second school — a public with
// a rigid core curriculum, or a community college. It does not need to be
// complete. It needs to prove the adapter boundary is real."
//
// This adapter is deliberately PARTIAL. What it proves: the canonical model in
// lib/types.ts absorbed a school whose degree shape is the opposite of
// Columbia's — a 30-credit rigid CUNY Pathways core where almost every bucket
// has needCourses === eligible.length (no choice at all), a 60-credit associate
// degree rather than a 124-credit bachelor's, and a discipline cap that
// Columbia has no analogue for. Zero lines of Columbia-specific code were
// touched to add it.
// ─────────────────────────────────────────────────────────────────────────────

const CATALOG = "https://www.bmcc.cuny.edu/academics/departments/cis/computer-science/";
const PATHWAYS = "https://www.bmcc.cuny.edu/academics/pathways/pathways-common-core-is-required/";
const REGISTRAR_FAQ = "https://www.bmcc.cuny.edu/registrar/policies-general-information/faq/";
const RETRIEVED = "2026-08-06";

const src = (url: string, quote: string, snapshot: string): Source => ({
  url,
  quote,
  retrievedAt: RETRIEVED,
  snapshotPath: `/data/snapshots/${snapshot}`,
});

const cid = (code: string) => `BMCC:${code.replace(/\s+/g, "")}`;
const COURSE = (code: string) => ({ op: "COURSE" as const, courseId: cid(code) });
const AND = (...children: any[]) => ({ op: "AND" as const, children });
const OR = (...children: any[]) => ({ op: "OR" as const, children });
const UNVER = (text: string) => ({ op: "UNVERIFIABLE" as const, text });

const C = (
  code: string,
  title: string,
  credits: number,
  description: string,
  prereq: Course["prereq"],
  termsOffered: Course["termsOffered"],
  skills: Course["skills"],
  verified = false,
  restrictions: string[] = [],
): Course => ({
  id: cid(code),
  code,
  title,
  credits,
  description,
  prereq,
  coreq: [],
  termsOffered,
  level: "UG",
  restrictions,
  verified,
  sourceUrl: CATALOG,
  skills,
});

const courses: Course[] = [
  C("ENG 101", "English Composition I", 3,
    "Instruction in the writing of expository essays, with attention to argument, evidence, revision and research.",
    null, ["FA", "SP", "SU"], [{ skill: "Technical writing", evidence: "Instruction in the writing of expository essays, with attention to argument, evidence, revision and research." }], true),

  C("ENG 201", "English Composition II", 3,
    "Continued instruction in expository and argumentative writing with an introduction to literary analysis and the research paper.",
    COURSE("ENG 101"), ["FA", "SP", "SU"], [{ skill: "Technical writing", evidence: "Continued instruction in expository and argumentative writing with an introduction to literary analysis and the research paper." }], true),

  C("MAT 206", "Precalculus", 4,
    "Functions and their graphs, polynomial and rational functions, exponential and logarithmic functions, and trigonometry, preparing students for calculus.",
    UNVER("Departmental placement or MAT 56"), ["FA", "SP", "SU"], [], true),

  C("MAT 301", "Analytic Geometry and Calculus I", 4,
    "Limits, continuity, the derivative and its applications, and an introduction to the definite integral.",
    UNVER("MAT 206 or departmental placement"), ["FA", "SP", "SU"],
    [{ skill: "Calculus", evidence: "Limits, continuity, the derivative and its applications, and an introduction to the definite integral." }], true),

  C("MAT 302", "Analytic Geometry and Calculus II", 4,
    "Techniques and applications of integration, sequences and series, and parametric and polar curves.",
    COURSE("MAT 301"), ["FA", "SP"],
    [{ skill: "Calculus", evidence: "Techniques and applications of integration, sequences and series, and parametric and polar curves." }], true),

  C("PHY 215", "University Physics I", 4,
    "Calculus-based mechanics: kinematics, Newton's laws, work and energy, momentum, rotational motion, and oscillations, with laboratory.",
    AND(COURSE("MAT 301")), ["FA", "SP"], [], true),

  C("CSC 101", "Introduction to Computer Science", 3,
    "An introduction to computer science and programming in Python: data types, control structures, functions, lists and dictionaries, files, and elementary algorithms.",
    null, ["FA", "SP", "SU"],
    [{ skill: "Python", evidence: "An introduction to computer science and programming in Python: data types, control structures, functions, lists and dictionaries, files, and elementary algorithms." }], true),

  C("CSC 111", "Introduction to Programming", 3,
    "Programming in a high-level language: problem decomposition, control flow, functions, arrays, and an introduction to object-oriented design.",
    COURSE("CSC 101"), ["FA", "SP"],
    [{ skill: "Object-oriented programming", evidence: "Programming in a high-level language: problem decomposition, control flow, functions, arrays, and an introduction to object-oriented design." }], true),

  C("CSC 211", "Advanced Programming Techniques", 3,
    "Object-oriented programming in Java: classes and inheritance, interfaces, exceptions, generics, collections, recursion, and file input/output.",
    OR(COURSE("CSC 111"), UNVER("or departmental approval")), ["FA", "SP"],
    [
      { skill: "Java", evidence: "Object-oriented programming in Java: classes and inheritance, interfaces, exceptions, generics, collections, recursion, and file input/output." },
      { skill: "Object-oriented programming", evidence: "Object-oriented programming in Java: classes and inheritance, interfaces, exceptions, generics, collections, recursion, and file input/output." },
    ], true),

  C("CSC 215", "Fundamentals of Computer Systems", 3,
    "Number systems, Boolean algebra and digital logic, processor organisation, memory hierarchy, and assembly language programming.",
    COURSE("CSC 111"), ["FA", "SP"],
    [{ skill: "Computer architecture", evidence: "Number systems, Boolean algebra and digital logic, processor organisation, memory hierarchy, and assembly language programming." }], true),

  C("CSC 231", "Discrete Structures and Applications to Computer Science", 4,
    "Sets, logic and proof techniques, functions and relations, combinatorics, recursion, graphs and trees, with applications to computer science.",
    OR(AND(COURSE("CSC 111"), COURSE("MAT 301")), UNVER("or departmental approval")), ["FA", "SP"],
    [{ skill: "Discrete mathematics", evidence: "Sets, logic and proof techniques, functions and relations, combinatorics, recursion, graphs and trees, with applications to computer science." }], true),

  C("CSC 331", "Data Structures", 3,
    "Arrays, linked lists, stacks, queues, trees, hash tables and graphs, with sorting and searching algorithms and analysis of their running time.",
    OR(AND(COURSE("CSC 211"), COURSE("CSC 231")), UNVER("or departmental approval")), ["FA", "SP"],
    [
      { skill: "Data structures", evidence: "Arrays, linked lists, stacks, queues, trees, hash tables and graphs, with sorting and searching algorithms and analysis of their running time." },
      { skill: "Algorithms", evidence: "Arrays, linked lists, stacks, queues, trees, hash tables and graphs, with sorting and searching algorithms and analysis of their running time." },
    ], true),

  C("CSC 350", "Software Development", 3,
    "The software development lifecycle: requirements, design, version control with Git, testing, debugging, and a team project.",
    COURSE("CSC 211"), ["SP"],
    [
      { skill: "Git", evidence: "The software development lifecycle: requirements, design, version control with Git, testing, debugging, and a team project." },
      { skill: "Testing", evidence: "The software development lifecycle: requirements, design, version control with Git, testing, debugging, and a team project." },
    ], true),

  // Program electives — the only real choice in this degree
  C("CIS 385", "Database Management Systems", 3,
    "Relational database design and SQL: entity-relationship modelling, normalisation, querying, and report generation.",
    COURSE("CSC 111"), ["FA", "SP"],
    [
      { skill: "SQL", evidence: "Relational database design and SQL: entity-relationship modelling, normalisation, querying, and report generation." },
      { skill: "Databases", evidence: "Relational database design and SQL: entity-relationship modelling, normalisation, querying, and report generation." },
    ]),

  C("CIS 395", "Data Analytics", 3,
    "Introduction to data analytics with Python: data cleaning, exploratory analysis with pandas, visualisation, and an introduction to predictive modelling with scikit-learn.",
    COURSE("CSC 101"), ["SP"],
    [
      { skill: "Python", evidence: "Introduction to data analytics with Python: data cleaning, exploratory analysis with pandas, visualisation, and an introduction to predictive modelling with scikit-learn." },
      { skill: "Machine learning", evidence: "Introduction to data analytics with Python: data cleaning, exploratory analysis with pandas, visualisation, and an introduction to predictive modelling with scikit-learn." },
      { skill: "Pandas", evidence: "Introduction to data analytics with Python: data cleaning, exploratory analysis with pandas, visualisation, and an introduction to predictive modelling with scikit-learn." },
    ]),

  C("CIS 345", "Web Programming", 3,
    "Client and server web development: HTML, CSS, JavaScript, HTTP, and building dynamic pages backed by a database.",
    COURSE("CSC 111"), ["FA"],
    [{ skill: "JavaScript", evidence: "Client and server web development: HTML, CSS, JavaScript, HTTP, and building dynamic pages backed by a database." }]),

  C("CIS 359", "Computer Networks and Security", 3,
    "Network fundamentals and security: the TCP/IP stack, routing, network services, common attacks, and defensive configuration.",
    COURSE("CSC 111"), ["SP"],
    [
      { skill: "Computer networks", evidence: "Network fundamentals and security: the TCP/IP stack, routing, network services, common attacks, and defensive configuration." },
      { skill: "TCP/IP", evidence: "Network fundamentals and security: the TCP/IP stack, routing, network services, common attacks, and defensive configuration." },
      { skill: "Security", evidence: "Network fundamentals and security: the TCP/IP stack, routing, network services, common attacks, and defensive configuration." },
    ]),

  C("CSC 203", "Object Oriented Programming", 3,
    "Advanced object-oriented design: encapsulation, polymorphism, design patterns, and unit testing.",
    COURSE("CSC 211"), ["FA"],
    [{ skill: "Object-oriented programming", evidence: "Advanced object-oriented design: encapsulation, polymorphism, design patterns, and unit testing." }]),

  // Flexible Core placeholders — rigid at the bucket level, chosen by area
  C("SPE 100", "Fundamentals of Public Speaking", 3,
    "Principles of oral communication: organisation, delivery, listening, and audience analysis, with graded speeches.",
    null, ["FA", "SP", "SU"],
    [{ skill: "Communication", evidence: "Principles of oral communication: organisation, delivery, listening, and audience analysis, with graded speeches." }], true),

  C("SOC 100", "Introduction to Sociology", 3,
    "Sociological concepts and methods: culture, socialisation, social structure, inequality, and institutions.",
    null, ["FA", "SP", "SU"], [], true),

  C("HIS 201", "History of the United States I", 3,
    "United States history from colonial settlement through Reconstruction.",
    null, ["FA", "SP"], [], true),

  C("ANT 100", "Introduction to Anthropology", 3,
    "Comparative study of human societies and cultures across the world.",
    null, ["FA", "SP", "SU"], [], true),
];

export const BMCC: School = {
  id: "BMCC",
  name: "Borough of Manhattan Community College, CUNY",
  shortName: "BMCC",
  structureNote:
    "Public, rigid. A 60 credit associate degree where 30 credits are a fixed CUNY Pathways core with named required courses and almost no choice. Only 6 credits of program electives and 4 of general electives are genuinely free, which is the opposite shape to Columbia and the reason it is here.",
  catalogUrl: CATALOG,
  courses,
  programs: [
    {
      id: "BMCC:CS_AS",
      name: "Computer Science, AS",
      level: "UG",
      school: "BMCC",
      totalCredits: 60,
      majorCredits: 60,
      maxCreditsPerTerm: 18,
      minCreditsPerTerm: 12,
      sources: [
        src(CATALOG, "TOTAL COMMON CORE 30", "bmcc-cs-as.html"),
        src(PATHWAYS,
          "No more than two courses in any discipline or interdisciplinary field can be used to satisfy Flexible Core requirements.",
          "bmcc-pathways.html"),
        src(REGISTRAR_FAQ, "Fall/Spring 18* credits/hours", "bmcc-registrar-faq.html"),
        src(REGISTRAR_FAQ, "*Students on academic notice are limited to 14 credits/hours for the Spring/Fall.", "bmcc-registrar-faq.html"),
      ],
      buckets: [
        {
          id: "BMCC:CS_AS:ENGLISH",
          label: "Required Common Core: English Composition",
          needCourses: 2,
          eligible: ["ENG 101", "ENG 201"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "English Composition 6", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:MATH_CORE",
          label: "Required Common Core: Mathematical and Quantitative Reasoning",
          needCourses: 1,
          eligible: ["MAT 206", "MAT 301"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "Students are required to take MAT 206 or MAT 301.", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:SCIENCE_CORE",
          label: "Required Common Core: Life and Physical Sciences",
          needCourses: 1,
          eligible: ["PHY 215"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "Students are required to take PHY 215.", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:SCIENTIFIC_WORLD",
          label: "Flexible Core: Scientific World",
          needCourses: 2,
          eligible: ["CSC 101", "CSC 111"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "Students are required to take CSC 101 and CSC 111.", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:CREATIVE_EXPRESSION",
          label: "Flexible Core: Creative Expression",
          needCourses: 1,
          eligible: ["SPE 100"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "Students are advised to take SPE 100 or SPE 102.", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:INDIVIDUAL_SOCIETY",
          label: "Flexible Core: Individual and Society",
          needCourses: 1,
          eligible: ["SOC 100", "ANT 100"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "Individual and Society 3", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:US_EXPERIENCE",
          label: "Flexible Core: U.S. Experience in Its Diversity",
          needCourses: 1,
          eligible: ["HIS 201"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG, "U.S. Experience in Its Diversity 3", "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:CURRICULUM",
          label: "Curriculum requirements",
          needCourses: 6,
          eligible: ["CSC 211", "CSC 215", "CSC 231", "CSC 331", "CSC 350", "MAT 302"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG,
            "CSC 211 Advanced Programming Techniques; CSC 215 Fundamentals of Computer Systems; CSC 231 Discrete Structures and Applications to Computer Science; CSC 331 Data Structures; CSC 350 Software Development",
            "bmcc-cs-as.html"),
        },
        {
          id: "BMCC:CS_AS:PROGRAM_ELECTIVE",
          label: "Program electives",
          needCourses: 2,
          eligible: ["CIS 385", "CIS 395", "CIS 345", "CIS 359", "CSC 203"].map(cid),
          allowDoubleCount: [],
          source: src(CATALOG,
            "Select 6 credits from CIS 317, CIS 345, CIS 359, CIS 362, CIS 364, CIS 385, CIS 395, CSC 103, GIS 201, CIS 316, CIS 272, CIS 285 or CSC 203.",
            "bmcc-cs-as.html"),
        },
      ],
    },
  ],
};
