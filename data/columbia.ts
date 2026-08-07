import type { School, Course, Source } from "@/lib/types";
import { COLUMBIA_EXTRA, COLUMBIA_OVERLAPS } from "./columbia-extra";

// ─────────────────────────────────────────────────────────────────────────────
// COLUMBIA COLLEGE — Computer Science BA. The deep school. BUILD_SPEC §6.2.
//
// PROVENANCE (§6.0): every bucket below carries a Source with a verbatim quote
// retrieved from the live bulletin on 2026-08-06. Bucket rules were encoded BY
// HAND, not by an LLM (§6 step 4) — they are few, high-stakes, and structured.
//
// The `verified` flag on each course is honest: `true` means a human confirmed
// the prerequisite parse against the catalog text; `false` means the tree is a
// best-effort encoding and the UI must say so. A parser that renders an
// unreviewed parse as a confident green check is lying (§4.1).
// ─────────────────────────────────────────────────────────────────────────────

const BULLETIN = "https://bulletin.columbia.edu/columbia-college/departments-instruction/computer-science/";
const REGISTRATION = "https://bulletin.columbia.edu/columbia-college/registration/";
const RETRIEVED = "2026-08-06";

const src = (url: string, quote: string, snapshot: string): Source => ({
  url,
  quote,
  retrievedAt: RETRIEVED,
  snapshotPath: `/data/snapshots/${snapshot}`,
});

const C = (
  code: string,
  title: string,
  credits: number,
  description: string,
  prereq: Course["prereq"],
  termsOffered: Course["termsOffered"],
  skills: Course["skills"],
  verified: boolean,
  restrictions: string[] = [],
): Course => ({
  id: `COLUMBIA:${code.replace(/\s+/g, "")}`,
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
  // The course's OWN page, not the department's.
  //
  // Every hand-written course used to carry the computer science department
  // URL, so "Read STAT UN1201 in the catalog" opened the computer science
  // department page, as did the link for Calculus III and for Introduction to
  // Econometrics. Twelve of the forty seven were not computer science courses
  // at all. The department page is the right citation for a DEGREE RULE, which
  // is where BULLETIN is still used, and the wrong one for a course.
  sourceUrl: courseUrl(code),
  skills,
});

/** The bulletin's own page for one course, the same form the ingest emits. */
const courseUrl = (code: string) =>
  `https://bulletin.columbia.edu/search/?P=${code.replace(/\s+/g, "%20")}`;

const cid = (code: string) => `COLUMBIA:${code.replace(/\s+/g, "")}`;
const COURSE = (code: string) => ({ op: "COURSE" as const, courseId: cid(code) });
const AND = (...children: any[]) => ({ op: "AND" as const, children });
const OR = (...children: any[]) => ({ op: "OR" as const, children });
const UNVER = (text: string) => ({ op: "UNVERIFIABLE" as const, text });

const courses: Course[] = [
  // ── CS core ────────────────────────────────────────────────────────────────
  C("COMS W1004", "Introduction to Computer Science and Programming in Java", 3,
    "A general introduction to computer science for science and engineering students interested in majoring in computer science or engineering. Covers fundamental concepts of computer science, algorithmic problem-solving capabilities, and introductory Java programming skills.",
    null, ["FA", "SP", "SU"],
    [{ skill: "Java", evidence: "introductory Java programming skills." }],
    true),

  C("COMS W3134", "Data Structures in Java", 3,
    "Data types and structures: arrays, stacks, singly and doubly linked lists, queues, trees, sets, and graphs. Programming techniques for processing such structures: sorting and searching, hashing, garbage collection. Storage management. Rudiments of the analysis of algorithms.",
    OR(COURSE("COMS W1004"), UNVER("or knowledge of Java")), ["FA", "SP", "SU"],
    [
      { skill: "Data structures", evidence: "Data types and structures: arrays, stacks, singly and doubly linked lists, queues, trees, sets, and graphs." },
      { skill: "Algorithms", evidence: "Rudiments of the analysis of algorithms." },
    ],
    true),

  C("COMS W3137", "Honors Data Structures and Algorithms", 4,
    "An honors introduction to data types and structures: arrays, stacks, singly and doubly linked lists, queues, trees, sets, and graphs. Programming techniques for processing such structures. Storage management. Rudiments of the analysis of algorithms.",
    AND(COURSE("COMS W1004"), UNVER("Honors version; instructor permission may be required")), ["FA"],
    [
      { skill: "Data structures", evidence: "An honors introduction to data types and structures: arrays, stacks, singly and doubly linked lists, queues, trees, sets, and graphs." },
      { skill: "Algorithms", evidence: "Rudiments of the analysis of algorithms." },
    ],
    true, ["Honors section. Instructor permission may be required."]),

  C("COMS W3157", "Advanced Programming", 4,
    "C programming language, Unix/Linux development environment, testing and debugging, make, version control, client/server programming, sockets, and a substantial team software project.",
    COURSE("COMS W3134"), ["FA", "SP"],
    [
      { skill: "C", evidence: "C programming language, Unix/Linux development environment, testing and debugging, make, version control, client/server programming, sockets, and a substantial team software project." },
      { skill: "Linux", evidence: "C programming language, Unix/Linux development environment, testing and debugging, make, version control, client/server programming, sockets, and a substantial team software project." },
      { skill: "Git", evidence: "C programming language, Unix/Linux development environment, testing and debugging, make, version control, client/server programming, sockets, and a substantial team software project." },
      { skill: "Testing", evidence: "C programming language, Unix/Linux development environment, testing and debugging, make, version control, client/server programming, sockets, and a substantial team software project." },
    ],
    true),

  C("COMS W3203", "Discrete Mathematics: Introduction to Combinatorics and Graph Theory", 3,
    "Logic and formal proofs, sequences and summation, mathematical induction, binomial coefficients, elements of finite probability, recurrence relations, equivalence relations and partial orderings, and topics in graph theory including trees, connectivity, and matchings.",
    null, ["FA", "SP", "SU"],
    [{ skill: "Discrete mathematics", evidence: "Logic and formal proofs, sequences and summation, mathematical induction, binomial coefficients, elements of finite probability, recurrence relations, equivalence relations and partial orderings, and topics in graph theory including trees, connectivity, and matchings." }],
    true),

  C("COMS W3261", "Computer Science Theory", 3,
    "Regular languages: finite automata, regular expressions, and their equivalence. Context-free languages: context-free grammars, push-down automata. Turing machines, the Chomsky hierarchy, and the Church-Turing thesis. Introduction to complexity theory and NP-completeness.",
    COURSE("COMS W3203"), ["FA", "SP"],
    [{ skill: "Theory of computation", evidence: "Turing machines, the Chomsky hierarchy, and the Church-Turing thesis." }],
    true),

  C("CSEE W3827", "Fundamentals of Computer Systems", 3,
    "Fundamentals of computer organization and digital logic. Boolean algebra, Karnaugh maps, basic gates and components, flipflops and latches, counters and state machines, basics of combinational and sequential digital design. Assembly language, instruction sets, ALU's, single-cycle and multi-cycle datapaths, pipelining, caches, and virtual memory.",
    null, ["FA", "SP"],
    [
      { skill: "Computer architecture", evidence: "Assembly language, instruction sets, ALU's, single-cycle and multi-cycle datapaths, pipelining, caches, and virtual memory." },
      { skill: "Systems programming", evidence: "Fundamentals of computer organization and digital logic." },
    ],
    true),

  // ── Math: calculus ─────────────────────────────────────────────────────────
  C("MATH UN1201", "Calculus III", 3,
    "Vectors in dimensions 2 and 3, complex numbers and the complex exponential function with applications to differential equations, Cramer's rule, vector-valued functions of one variable, scalar-valued functions of several variables, partial derivatives, gradient, optimization in several variables.",
    UNVER("MATH UN1102 or the equivalent"), ["FA", "SP", "SU"],
    [{ skill: "Multivariable calculus", evidence: "scalar-valued functions of several variables, partial derivatives, gradient, optimization in several variables." }],
    true),

  C("MATH UN1205", "Accelerated Multivariable Calculus", 4,
    "Vectors and matrices, vector-valued functions, parametrized curves and their geometry, partial derivatives, gradients, optimization, double and triple integrals, line and surface integrals, vector calculus.",
    UNVER("MATH UN1102 or the equivalent"), ["SP"],
    [{ skill: "Multivariable calculus", evidence: "partial derivatives, gradients, optimization, double and triple integrals, line and surface integrals, vector calculus." }],
    false),

  C("APMA E2000", "Multivariable Calculus for Engineers and Applied Scientists", 4,
    "Vectors in R2 and R3, vector-valued functions, multivariable calculus, partial derivatives, gradient, optimization in several variables, multiple integrals with applications to engineering and the applied sciences.",
    UNVER("Calculus I and II or the equivalent"), ["FA", "SP"],
    [{ skill: "Multivariable calculus", evidence: "multivariable calculus, partial derivatives, gradient, optimization in several variables, multiple integrals with applications to engineering and the applied sciences." }],
    false),

  // ── Math: linear algebra ───────────────────────────────────────────────────
  C("COMS W3251", "Computational Linear Algebra", 3,
    "Computational aspects of linear algebra: vector spaces, matrices, linear transformations, eigenvalues and eigenvectors, singular value decomposition, and least squares, with computational exercises in a numerical computing environment.",
    UNVER("Knowledge of calculus"), ["FA", "SP"],
    [
      { skill: "Linear algebra", evidence: "Computational aspects of linear algebra: vector spaces, matrices, linear transformations, eigenvalues and eigenvectors, singular value decomposition, and least squares, with computational exercises in a numerical computing environment." },
      { skill: "NumPy", evidence: "with computational exercises in a numerical computing environment." },
    ],
    true),

  C("MATH UN2010", "Linear Algebra", 3,
    "Matrices, vector spaces, linear transformations, eigenvalues and eigenvectors, canonical forms, applications.",
    UNVER("MATH UN1201 or the equivalent"), ["FA", "SP", "SU"],
    [{ skill: "Linear algebra", evidence: "Matrices, vector spaces, linear transformations, eigenvalues and eigenvectors, canonical forms, applications." }],
    true),

  C("MATH UN2015", "Linear Algebra and Probability", 3,
    "Introduction to linear algebra with a focus on probability. Matrices, vector spaces, eigenvalues and eigenvectors, Markov chains, random variables, expectation and variance, and the central limit theorem.",
    UNVER("MATH UN1201 or the equivalent"), ["FA"],
    [
      { skill: "Linear algebra", evidence: "Matrices, vector spaces, eigenvalues and eigenvectors, Markov chains, random variables, expectation and variance, and the central limit theorem." },
      { skill: "Probability", evidence: "random variables, expectation and variance, and the central limit theorem." },
    ],
    false),

  C("MATH UN2020", "Honors Linear Algebra", 3,
    "A more extensive treatment of the material in MATH UN2010 with an emphasis on proofs: vector spaces, linear transformations, eigenvalues, inner product spaces, and canonical forms.",
    UNVER("MATH UN1201 or the equivalent; honors section"), ["SP"],
    [{ skill: "Linear algebra", evidence: "vector spaces, linear transformations, eigenvalues, inner product spaces, and canonical forms." }],
    false, ["Honors section"]),

  C("APMA E2101", "Introduction to Applied Mathematics", 3,
    "An introduction to applied mathematics for engineers: linear algebra, vector spaces, matrices, eigenvalues and eigenvectors, and ordinary differential equations with engineering applications.",
    UNVER("Calculus or the equivalent"), ["FA", "SP"],
    [{ skill: "Linear algebra", evidence: "An introduction to applied mathematics for engineers: linear algebra, vector spaces, matrices, eigenvalues and eigenvectors, and ordinary differential equations with engineering applications." }],
    false),

  C("APMA E3101", "Linear Algebra", 3,
    "Vector spaces, matrices, systems of linear equations, determinants, eigenvalues and eigenvectors, diagonalization, and applications to engineering problems.",
    UNVER("Calculus or the equivalent"), ["FA", "SP"],
    [{ skill: "Linear algebra", evidence: "Vector spaces, matrices, systems of linear equations, determinants, eigenvalues and eigenvectors, diagonalization, and applications to engineering problems." }],
    false),

  // ── Math: probability / statistics ─────────────────────────────────────────
  C("STAT UN1201", "Calculus-Based Introduction to Statistics", 3,
    "A calculus-based introduction to statistical inference: probability, random variables, expectation, sampling distributions, estimation, confidence intervals, hypothesis testing, and linear regression, with computing in R.",
    UNVER("One term of calculus"), ["FA", "SP", "SU"],
    [
      { skill: "Statistics", evidence: "probability, random variables, expectation, sampling distributions, estimation, confidence intervals, hypothesis testing, and linear regression, with computing in R." },
      { skill: "Probability", evidence: "probability, random variables, expectation, sampling distributions, estimation, confidence intervals, hypothesis testing, and linear regression, with computing in R." },
    ],
    true),

  C("STAT GU4001", "Introduction to Probability and Statistics", 3,
    "A calculus-based introduction to probability theory and statistical inference: random variables, distributions, expectation, limit theorems, estimation, and hypothesis testing.",
    UNVER("Calculus through multivariable"), ["FA", "SP"],
    [
      { skill: "Probability", evidence: "A calculus-based introduction to probability theory and statistical inference: random variables, distributions, expectation, limit theorems, estimation, and hypothesis testing." },
      { skill: "Statistics", evidence: "A calculus-based introduction to probability theory and statistical inference: random variables, distributions, expectation, limit theorems, estimation, and hypothesis testing." },
    ],
    false),

  C("IEOR E3658", "Probability for Engineers", 3,
    "Probability spaces, random variables, discrete and continuous distributions, expectation, conditional probability, limit theorems, and an introduction to stochastic processes for engineering applications.",
    UNVER("Calculus through multivariable"), ["FA", "SP"],
    [{ skill: "Probability", evidence: "Probability spaces, random variables, discrete and continuous distributions, expectation, conditional probability, limit theorems, and an introduction to stochastic processes for engineering applications." }],
    false),

  // ── Area foundation (21 courses, verbatim from the bulletin list) ──────────
  C("COMS W4111", "Introduction to Databases", 3,
    "The fundamentals of database design and application development using databases: entity-relationship modelling, logical design of relational databases, relational data definition and manipulation languages, SQL, XML, query processing, physical database tuning, transaction processing.",
    COURSE("COMS W3134"), ["FA", "SP"],
    [
      { skill: "SQL", evidence: "relational data definition and manipulation languages, SQL, XML, query processing, physical database tuning, transaction processing." },
      { skill: "Databases", evidence: "The fundamentals of database design and application development using databases: entity-relationship modelling, logical design of relational databases, relational data definition and manipulation languages, SQL, XML, query processing, physical database tuning, transaction processing." },
      { skill: "Data modeling", evidence: "entity-relationship modelling, logical design of relational databases, relational data definition and manipulation languages, SQL, XML, query processing, physical database tuning, transaction processing." },
    ],
    true),

  C("COMS W4113", "Fundamentals of Large-Scale Distributed Systems", 3,
    "Design and implementation of large-scale distributed systems. Topics include replication, consistency models, consensus protocols such as Paxos and Raft, fault tolerance, distributed storage, and scalability. Substantial systems programming projects in Go.",
    AND(COURSE("COMS W3157"), COURSE("CSEE W3827")), ["FA"],
    [
      { skill: "Distributed systems", evidence: "Design and implementation of large-scale distributed systems." },
      { skill: "Consensus protocols", evidence: "Topics include replication, consistency models, consensus protocols such as Paxos and Raft, fault tolerance, distributed storage, and scalability." },
      { skill: "Fault tolerance", evidence: "Topics include replication, consistency models, consensus protocols such as Paxos and Raft, fault tolerance, distributed storage, and scalability." },
      { skill: "Go", evidence: "Substantial systems programming projects in Go." },
      { skill: "Scalability", evidence: "Topics include replication, consistency models, consensus protocols such as Paxos and Raft, fault tolerance, distributed storage, and scalability." },
    ],
    true),

  C("COMS W4115", "Programming Languages and Translators", 3,
    "Modern programming languages and compiler design. Language syntax and semantics, lexical analysis, parsing, type systems, intermediate representations, code generation and optimization. Students build a complete compiler for a language of their own design.",
    AND(COURSE("COMS W3134"), COURSE("COMS W3261")), ["SP"],
    [{ skill: "Compilers", evidence: "Modern programming languages and compiler design." }],
    true),

  C("COMS W4118", "Operating Systems I", 3,
    "Design and implementation of operating systems. Processes and threads, scheduling, synchronisation, virtual memory, file systems, device drivers, and containers. Substantial kernel programming assignments in C on Linux.",
    AND(COURSE("COMS W3157"), COURSE("CSEE W3827")), ["FA", "SP"],
    [
      { skill: "Operating systems", evidence: "Design and implementation of operating systems." },
      { skill: "Concurrency", evidence: "Processes and threads, scheduling, synchronisation, virtual memory, file systems, device drivers, and containers." },
      { skill: "Containers", evidence: "Processes and threads, scheduling, synchronisation, virtual memory, file systems, device drivers, and containers." },
      { skill: "Linux", evidence: "Substantial kernel programming assignments in C on Linux." },
    ],
    true),

  C("COMS W4119", "Computer Networks", 3,
    "Introduction to computer networks and the technical foundations of the Internet. Applications, transport, network and link layers, TCP/IP, routing, congestion control, wireless networks, and network security. Programming assignments implementing distributed network applications in Python.",
    COURSE("COMS W3134"), ["SP"],
    [
      { skill: "Computer networks", evidence: "Introduction to computer networks and the technical foundations of the Internet." },
      { skill: "TCP/IP", evidence: "Applications, transport, network and link layers, TCP/IP, routing, congestion control, wireless networks, and network security." },
      { skill: "Python", evidence: "Programming assignments implementing distributed network applications in Python." },
      { skill: "Distributed systems", evidence: "Programming assignments implementing distributed network applications in Python." },
    ],
    true),

  C("COMS W4152", "Engineering Software-as-a-Service", 3,
    "Building and operating software delivered as a service. Agile development, Ruby on Rails, REST APIs, cloud deployment, continuous integration and deployment, monitoring, and A/B testing.",
    COURSE("COMS W3157"), ["FA"],
    [
      { skill: "Cloud deployment", evidence: "Agile development, Ruby on Rails, REST APIs, cloud deployment, continuous integration and deployment, monitoring, and A/B testing." },
      { skill: "CI/CD", evidence: "Agile development, Ruby on Rails, REST APIs, cloud deployment, continuous integration and deployment, monitoring, and A/B testing." },
      { skill: "REST APIs", evidence: "Agile development, Ruby on Rails, REST APIs, cloud deployment, continuous integration and deployment, monitoring, and A/B testing." },
      { skill: "Monitoring", evidence: "Agile development, Ruby on Rails, REST APIs, cloud deployment, continuous integration and deployment, monitoring, and A/B testing." },
    ],
    false),

  C("COMS W4156", "Advanced Software Engineering", 3,
    "Software engineering for large systems: requirements, architecture and design, service-oriented architecture, testing strategies, static analysis, code review, and team project work with continuous integration.",
    COURSE("COMS W3157"), ["FA", "SP"],
    [
      { skill: "Software architecture", evidence: "Software engineering for large systems: requirements, architecture and design, service-oriented architecture, testing strategies, static analysis, code review, and team project work with continuous integration." },
      { skill: "Testing", evidence: "Software engineering for large systems: requirements, architecture and design, service-oriented architecture, testing strategies, static analysis, code review, and team project work with continuous integration." },
      { skill: "CI/CD", evidence: "Software engineering for large systems: requirements, architecture and design, service-oriented architecture, testing strategies, static analysis, code review, and team project work with continuous integration." },
    ],
    true),

  C("COMS W4160", "Computer Graphics", 3,
    "Introduction to computer graphics: ray tracing, rasterisation, transformations, shading models, texture mapping, and the modern programmable GPU pipeline. Programming assignments in C++ and GLSL.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of linear algebra")), ["FA"],
    [
      { skill: "Computer graphics", evidence: "Introduction to computer graphics: ray tracing, rasterisation, transformations, shading models, texture mapping, and the modern programmable GPU pipeline." },
      { skill: "GPU programming", evidence: "Introduction to computer graphics: ray tracing, rasterisation, transformations, shading models, texture mapping, and the modern programmable GPU pipeline." },
      { skill: "C++", evidence: "Programming assignments in C++ and GLSL." },
    ],
    false),

  C("COMS W4167", "Computer Animation", 3,
    "Physically based animation: numerical integration of ordinary differential equations, mass-spring systems, rigid bodies, collision detection and response, and fluid simulation.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of linear algebra and calculus")), ["FA"],
    [{ skill: "Numerical methods", evidence: "Physically based animation: numerical integration of ordinary differential equations, mass-spring systems, rigid bodies, collision detection and response, and fluid simulation." }],
    false),

  C("COMS W4170", "User Interface Design", 3,
    "Human-computer interaction and user interface design: design methods, prototyping, evaluation and user studies, accessibility, and implementation of interactive systems.",
    COURSE("COMS W3134"), ["FA"],
    [{ skill: "UI design", evidence: "Human-computer interaction and user interface design: design methods, prototyping, evaluation and user studies, accessibility, and implementation of interactive systems." }],
    true),

  C("COMS W4181", "Security I", 3,
    "Introduction to computer security: threat models, cryptography in practice, authentication, access control, web security, software vulnerabilities and defences, and secure system design.",
    AND(COURSE("COMS W3157"), COURSE("CSEE W3827")), ["SP"],
    [
      { skill: "Security", evidence: "Introduction to computer security: threat models, cryptography in practice, authentication, access control, web security, software vulnerabilities and defences, and secure system design." },
      { skill: "Cryptography", evidence: "Introduction to computer security: threat models, cryptography in practice, authentication, access control, web security, software vulnerabilities and defences, and secure system design." },
    ],
    false),

  C("CSOR E4231", "Analysis of Algorithms I", 3,
    "Design and analysis of efficient algorithms: divide and conquer, greedy algorithms, dynamic programming, graph algorithms, network flow, linear programming, and NP-completeness.",
    AND(COURSE("COMS W3134"), COURSE("COMS W3203")), ["FA", "SP"],
    [
      { skill: "Algorithms", evidence: "Design and analysis of efficient algorithms: divide and conquer, greedy algorithms, dynamic programming, graph algorithms, network flow, linear programming, and NP-completeness." },
      { skill: "Optimization", evidence: "Design and analysis of efficient algorithms: divide and conquer, greedy algorithms, dynamic programming, graph algorithms, network flow, linear programming, and NP-completeness." },
    ],
    true),

  C("COMS W4236", "Introduction to Computational Complexity", 3,
    "Time and space complexity classes, reductions, completeness, the polynomial hierarchy, randomised complexity classes, and interactive proofs.",
    COURSE("COMS W3261"), ["SP"],
    [{ skill: "Complexity theory", evidence: "Time and space complexity classes, reductions, completeness, the polynomial hierarchy, randomised complexity classes, and interactive proofs." }],
    false),

  C("COMS W4701", "Artificial Intelligence", 3,
    "Introduction to artificial intelligence: search, constraint satisfaction, adversarial search, logical agents, planning, probabilistic reasoning and Bayesian networks, and an introduction to machine learning. Programming assignments in Python.",
    AND(COURSE("COMS W3134"), COURSE("COMS W3203")), ["FA", "SP"],
    [
      { skill: "Artificial intelligence", evidence: "Introduction to artificial intelligence: search, constraint satisfaction, adversarial search, logical agents, planning, probabilistic reasoning and Bayesian networks, and an introduction to machine learning." },
      { skill: "Machine learning", evidence: "Introduction to artificial intelligence: search, constraint satisfaction, adversarial search, logical agents, planning, probabilistic reasoning and Bayesian networks, and an introduction to machine learning." },
      { skill: "Python", evidence: "Programming assignments in Python." },
      { skill: "Constraint solving", evidence: "Introduction to artificial intelligence: search, constraint satisfaction, adversarial search, logical agents, planning, probabilistic reasoning and Bayesian networks, and an introduction to machine learning." },
    ],
    true),

  C("COMS W4705", "Natural Language Processing", 3,
    "Computational approaches to natural language: language models, sequence labelling, parsing, distributional semantics, neural sequence-to-sequence models and transformers, and evaluation. Assignments use Python and PyTorch.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of probability and linear algebra")), ["FA", "SP"],
    [
      { skill: "NLP", evidence: "Computational approaches to natural language: language models, sequence labelling, parsing, distributional semantics, neural sequence-to-sequence models and transformers, and evaluation." },
      { skill: "Transformers", evidence: "Computational approaches to natural language: language models, sequence labelling, parsing, distributional semantics, neural sequence-to-sequence models and transformers, and evaluation." },
      { skill: "PyTorch", evidence: "Assignments use Python and PyTorch." },
      { skill: "Python", evidence: "Assignments use Python and PyTorch." },
      { skill: "Deep learning", evidence: "Computational approaches to natural language: language models, sequence labelling, parsing, distributional semantics, neural sequence-to-sequence models and transformers, and evaluation." },
    ],
    true),

  C("COMS W4731", "Computer Vision I: First Principles", 3,
    "Introduction to computer vision: image formation, filtering, edge and feature detection, stereo and structure from motion, segmentation, and object recognition with convolutional neural networks.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of linear algebra and calculus")), ["FA"],
    [
      { skill: "Computer vision", evidence: "Introduction to computer vision: image formation, filtering, edge and feature detection, stereo and structure from motion, segmentation, and object recognition with convolutional neural networks." },
      { skill: "Deep learning", evidence: "Introduction to computer vision: image formation, filtering, edge and feature detection, stereo and structure from motion, segmentation, and object recognition with convolutional neural networks." },
    ],
    true),

  C("COMS W4733", "Computational Aspects of Robotics", 3,
    "Introduction to robotics: kinematics, motion planning, configuration space, sensing and localisation, and robot control. Programming assignments use Python and ROS.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of linear algebra")), ["SP"],
    [
      { skill: "Robotics", evidence: "Introduction to robotics: kinematics, motion planning, configuration space, sensing and localisation, and robot control." },
      { skill: "Python", evidence: "Programming assignments use Python and ROS." },
    ],
    false),

  C("CBMF W4761", "Computational Genomics", 3,
    "Algorithms and machine learning for genomic data: sequence alignment, hidden Markov models, gene expression analysis, and clustering and classification of high-dimensional biological data.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of probability")), ["FA"],
    [
      { skill: "Machine learning", evidence: "Algorithms and machine learning for genomic data: sequence alignment, hidden Markov models, gene expression analysis, and clustering and classification of high-dimensional biological data." },
      { skill: "Bioinformatics", evidence: "Algorithms and machine learning for genomic data: sequence alignment, hidden Markov models, gene expression analysis, and clustering and classification of high-dimensional biological data." },
    ],
    false),

  C("COMS W4771", "Machine Learning", 3,
    "Introduction to machine learning: supervised learning, linear and logistic regression, support vector machines, kernel methods, decision trees and ensembles, neural networks and backpropagation, unsupervised learning, and model selection and generalisation. Assignments use Python, NumPy and PyTorch.",
    AND(COURSE("COMS W3134"), UNVER("knowledge of linear algebra and probability")), ["FA", "SP"],
    [
      { skill: "Machine learning", evidence: "Introduction to machine learning: supervised learning, linear and logistic regression, support vector machines, kernel methods, decision trees and ensembles, neural networks and backpropagation, unsupervised learning, and model selection and generalisation." },
      { skill: "Deep learning", evidence: "Introduction to machine learning: supervised learning, linear and logistic regression, support vector machines, kernel methods, decision trees and ensembles, neural networks and backpropagation, unsupervised learning, and model selection and generalisation." },
      { skill: "PyTorch", evidence: "Assignments use Python, NumPy and PyTorch." },
      { skill: "NumPy", evidence: "Assignments use Python, NumPy and PyTorch." },
      { skill: "Python", evidence: "Assignments use Python, NumPy and PyTorch." },
      { skill: "Model evaluation", evidence: "Introduction to machine learning: supervised learning, linear and logistic regression, support vector machines, kernel methods, decision trees and ensembles, neural networks and backpropagation, unsupervised learning, and model selection and generalisation." },
    ],
    true),

  C("CSEE W4824", "Computer Architecture", 3,
    "Modern processor architecture: instruction-level parallelism, pipelining, branch prediction, memory hierarchy and cache design, multiprocessors and cache coherence, and hardware accelerators including GPUs.",
    COURSE("CSEE W3827"), ["SP"],
    [
      { skill: "Computer architecture", evidence: "Modern processor architecture: instruction-level parallelism, pipelining, branch prediction, memory hierarchy and cache design, multiprocessors and cache coherence, and hardware accelerators including GPUs." },
      { skill: "GPU programming", evidence: "Modern processor architecture: instruction-level parallelism, pipelining, branch prediction, memory hierarchy and cache design, multiprocessors and cache coherence, and hardware accelerators including GPUs." },
    ],
    true),

  C("CSEE W4868", "System-on-Chip Platforms", 3,
    "Design of system-on-chip platforms: hardware/software co-design, high-level synthesis, on-chip communication, and accelerator integration for embedded and data-centre workloads.",
    COURSE("CSEE W3827"), ["FA"],
    [{ skill: "Hardware design", evidence: "Design of system-on-chip platforms: hardware/software co-design, high-level synthesis, on-chip communication, and accelerator integration for embedded and data-centre workloads." }],
    false),

  // ── Additional COMS 3000+ courses eligible as CS electives ─────────────────
  C("COMS W4121", "Computer Systems for Data Science", 3,
    "Computer systems that support large-scale data analysis: storage formats, columnar databases, distributed query execution, Spark, and the systems trade-offs behind machine learning pipelines.",
    AND(COURSE("COMS W3134"), COURSE("COMS W3157")), ["SP"],
    [
      { skill: "Data engineering", evidence: "Computer systems that support large-scale data analysis: storage formats, columnar databases, distributed query execution, Spark, and the systems trade-offs behind machine learning pipelines." },
      { skill: "Spark", evidence: "Computer systems that support large-scale data analysis: storage formats, columnar databases, distributed query execution, Spark, and the systems trade-offs behind machine learning pipelines." },
      { skill: "ML pipelines", evidence: "Computer systems that support large-scale data analysis: storage formats, columnar databases, distributed query execution, Spark, and the systems trade-offs behind machine learning pipelines." },
      { skill: "Distributed systems", evidence: "Computer systems that support large-scale data analysis: storage formats, columnar databases, distributed query execution, Spark, and the systems trade-offs behind machine learning pipelines." },
    ],
    false),

  C("COMS W4153", "Cloud Computing", 3,
    "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale.",
    COURSE("COMS W3157"), ["FA", "SP"],
    [
      { skill: "Cloud deployment", evidence: "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale." },
      { skill: "Kubernetes", evidence: "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale." },
      { skill: "Containers", evidence: "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale." },
      { skill: "Microservices", evidence: "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale." },
      { skill: "Scalability", evidence: "Architecture and engineering of cloud applications: virtualisation, containers and Kubernetes, microservices, serverless computing, infrastructure as code, and operating services at scale." },
    ],
    false),

  C("COMS W4995", "Deep Learning Systems: Algorithms and Implementation", 3,
    "The design and implementation of deep learning systems. Automatic differentiation, tensor libraries, GPU acceleration, training large models, distributed data and model parallelism, and model serving in production. Students build a deep learning framework from scratch in Python and compare against PyTorch.",
    AND(COURSE("COMS W4771"), UNVER("or instructor permission")), ["FA", "SP"],
    [
      { skill: "Deep learning", evidence: "The design and implementation of deep learning systems." },
      { skill: "PyTorch", evidence: "Students build a deep learning framework from scratch in Python and compare against PyTorch." },
      { skill: "GPU programming", evidence: "Automatic differentiation, tensor libraries, GPU acceleration, training large models, distributed data and model parallelism, and model serving in production." },
      { skill: "Distributed training", evidence: "Automatic differentiation, tensor libraries, GPU acceleration, training large models, distributed data and model parallelism, and model serving in production." },
      { skill: "Model serving", evidence: "Automatic differentiation, tensor libraries, GPU acceleration, training large models, distributed data and model parallelism, and model serving in production." },
      { skill: "Python", evidence: "Students build a deep learning framework from scratch in Python and compare against PyTorch." },
    ],
    false, ["Topics course. Offering and content vary by term, and instructor permission may be required."]),

  C("COMS W4246", "Algorithms for Data Science", 3,
    "Algorithmic techniques for large data: sketching and streaming, hashing and similarity search, dimensionality reduction, randomised algorithms, and optimisation methods used in data science.",
    AND(COURSE("COMS W3134"), COURSE("COMS W3203")), ["FA"],
    [
      { skill: "Algorithms", evidence: "Algorithmic techniques for large data: sketching and streaming, hashing and similarity search, dimensionality reduction, randomised algorithms, and optimisation methods used in data science." },
      { skill: "Optimization", evidence: "Algorithmic techniques for large data: sketching and streaming, hashing and similarity search, dimensionality reduction, randomised algorithms, and optimisation methods used in data science." },
    ],
    false),

  C("COMS W3902", "Undergraduate Thesis", 3,
    "Independent research under the supervision of a faculty member, culminating in a written thesis. Open to majors who have secured a faculty sponsor.",
    UNVER("Faculty sponsor and departmental approval required"), ["FA", "SP"],
    [{ skill: "Research", evidence: "Independent research under the supervision of a faculty member, culminating in a written thesis." }],
    true, ["Requires a faculty sponsor and departmental approval"]),

  C("COMS W3132", "Idiomatic Python", 1,
    "Idiomatic Python programming: data model, iterators and generators, comprehensions, decorators, typing, testing, and packaging.",
    OR(COURSE("COMS W1004"), COURSE("COMS W3134")), ["FA", "SP"],
    [{ skill: "Python", evidence: "Idiomatic Python programming: data model, iterators and generators, comprehensions, decorators, typing, testing, and packaging." }],
    false),

  C("COMS W3210", "Scientific Computation", 3,
    "Numerical methods for scientific computing: floating-point arithmetic, root finding, interpolation, numerical linear algebra, quadrature, and ordinary differential equations, with implementations in Python and NumPy.",
    UNVER("Knowledge of calculus and linear algebra"), ["SP"],
    [
      { skill: "Numerical methods", evidence: "Numerical methods for scientific computing: floating-point arithmetic, root finding, interpolation, numerical linear algebra, quadrature, and ordinary differential equations, with implementations in Python and NumPy." },
      { skill: "NumPy", evidence: "Numerical methods for scientific computing: floating-point arithmetic, root finding, interpolation, numerical linear algebra, quadrature, and ordinary differential equations, with implementations in Python and NumPy." },
    ],
    false),
];

const AREA_FOUNDATION = [
  "COMS W4111", "COMS W4113", "COMS W4115", "COMS W4118", "COMS W4119",
  "COMS W4152", "COMS W4156", "COMS W4160", "COMS W4167", "COMS W4170",
  "COMS W4181", "CSOR E4231", "COMS W4236", "COMS W4701", "COMS W4705",
  "COMS W4731", "COMS W4733", "CBMF W4761", "COMS W4771", "CSEE W4824",
  "CSEE W4868",
].map(cid);

const byId = new Set(courses.map((c) => c.id));

/**
 * The same course, listed twice.
 *
 * Columbia cross-lists: Computer Networks appears as both COMS W4119 and
 * CSEE W4119, Analysis of Algorithms I appears three times as CSOR E4231,
 * COMS W4231 and CSOR W4231. Keyed by id they are different courses, so a plan
 * happily scheduled Computer Networks in two separate semesters and charged the
 * student for both. Keyed by catalog number and title they are obviously one
 * course, so the hand-checked entry wins and the rest are dropped.
 */
const identity = (c: Course) =>
  `${c.code.replace(/[^0-9]/g, "")}|${c.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

const survivor = new Map<string, string>();          // identity -> id that stays
for (const c of courses) survivor.set(identity(c), c.id);

const merged: Course[] = [...courses];
/** dropped id -> the id of the listing that stands in for it */
const rewrite = new Map<string, string>();
for (const c of COLUMBIA_EXTRA) {
  if (byId.has(c.id)) {
    // The hand-checked record wins on everything it states, but it cannot win
    // on a fact it does not carry. The bulletin says Honors Linear Algebra is
    // "not to be taken in addition to MATH UN2010"; the parser reads that off
    // the page and the hand-written entry never mentioned it, so dropping the
    // whole generated row put both courses in one plan. Take the rule.
    const hand = courses.find((h) => h.id === c.id);
    if (hand && !hand.overlapsWith?.length && c.overlapsWith?.length) {
      hand.overlapsWith = c.overlapsWith;
    }
    continue;
  }
  const key = identity(c);
  const keeper = survivor.get(key);
  if (keeper) { rewrite.set(c.id, keeper); continue; }
  survivor.set(key, c.id);
  merged.push(c);
}

/**
 * Dropping a cross-listing is not enough on its own.
 *
 * Other courses cite the dropped one as a prerequisite: COMS W4182 requires
 * CSEE W4119, and once that row is merged away the requirement points at a
 * course the catalog no longer holds. The solver would then treat W4182 as
 * unreachable and quietly remove it from every plan. So every prerequisite
 * naming a merged listing is repointed at the listing that survived. The
 * solver's own check for dangling prerequisites is what caught this.
 */
function repoint(n: Course["prereq"]): Course["prereq"] {
  if (!n) return null;
  if (n.op === "COURSE") {
    const to = rewrite.get(n.courseId);
    return to ? { op: "COURSE", courseId: to } : n;
  }
  if (n.op === "AND" || n.op === "OR") {
    return { op: n.op, children: n.children.map(repoint).filter(Boolean) as NonNullable<Course["prereq"]>[] };
  }
  return n;
}

const allCourses: Course[] = merged.map((c) =>
  c.prereq ? { ...c, prereq: repoint(c.prereq) } : c,
);

/**
 * Apply the bulletin's "cannot both count" rules over the merged catalog.
 *
 * Done here rather than on the rows themselves for two reasons. A rule survives
 * a course whose description did not parse, which is how Honors Linear Algebra
 * lost its rule and let a plan hold both linear algebra courses. And a rule
 * naming a cross-listing that was merged away has to follow the merge: "may not
 * receive credit for both COMS W4771 and W4776" points at a row that no longer
 * exists once the two listings become one, and a rule pointing at nothing
 * enforces nothing.
 */
{
  const present = new Set(allCourses.map((c) => c.id));
  for (const c of allCourses) {
    const stated = c.overlapsWith?.length ? c.overlapsWith : COLUMBIA_OVERLAPS[c.id];
    if (!stated?.length) continue;
    const resolved = [...new Set(stated.map((id) => rewrite.get(id) ?? id))]
      .filter((id) => id !== c.id && present.has(id));
    if (resolved.length) c.overlapsWith = resolved;
  }
  // The rule is symmetric: the page that states it is only one of the two.
  for (const c of allCourses) {
    for (const other of c.overlapsWith ?? []) {
      const o = allCourses.find((x) => x.id === other);
      if (o && !(o.overlapsWith ?? []).includes(c.id)) {
        o.overlapsWith = [...(o.overlapsWith ?? []), c.id];
      }
    }
  }
}

// "Any three COMS courses ... at least 3 points and are at the 3000 level or above."
// Encoded as a predicate evaluated at build time over the committed catalog.
//
// Evaluated over allCourses, not over the hand-written array above. It used to
// run over the forty courses written out by hand here, which meant the printed
// bulletin rule allowed eighty seven courses and the solver could reach thirty
// four of them. Database System Implementation, the closest thing in the whole
// catalog to "optimizing service performance, data processing, and system
// reliability", was unreachable no matter how highly anything rated it.
const CS_ELECTIVE_ELIGIBLE = allCourses
  .filter((c) => {
    const num = parseInt(c.code.replace(/[^0-9]/g, ""), 10);
    const dept = c.code.split(/\s+/)[0];
    return (
      ["COMS", "CSEE", "CSOR", "CBMF"].includes(dept) &&
      num >= 3000 &&
      c.credits >= 3 &&
      !["COMS W1004"].includes(c.code)
    );
  })
  .map((c) => c.id);

// The hand-checked courses above are the ones the degree requirements name, so
// they win on any collision. Everything else the bulletin publishes is appended
// after them, which is what makes it possible to plan for a job the CS core
// never anticipated.

export const COLUMBIA: School = {
  id: "COLUMBIA",
  name: "Columbia University in the City of New York",
  shortName: "Columbia",
  structureNote:
    "Private, flexible. The CS major is a small required core plus wide latitude: three area foundation courses chosen from twenty one, and three open CS electives. Most of the degree's freedom lives here.",
  catalogUrl: BULLETIN,
  courses: allCourses,
  programs: [
    {
      id: "COLUMBIA:CS_BA",
      name: "Computer Science, BA",
      level: "UG",
      school: "COLUMBIA",
      totalCredits: 124,
      majorCredits: 47,
      maxCreditsPerTerm: 18,
      minCreditsPerTerm: 12,
      sources: [
        src(REGISTRATION,
          "Students are allowed to register for a maximum of 18 points of credit in any Fall or Spring term.",
          "columbia-registration.html"),
        src(REGISTRATION,
          "All Columbia College students must be registered for a minimum of 12 points of credit in any given semester.",
          "columbia-registration.html"),
        // The bulletin states the double-count permission itself, so the
        // solver's allowDoubleCount is not our inference — it is their rule.
        src(BULLETIN, "NOTE: Math 2015 Linear Algebra and Probability may simultaneously satisfy both linear algebra and probability requirements without the need to take additional classes thus reducing the total number of points required.",
          "columbia-cs-bulletin.html"),
      ],
      buckets: [
        {
          id: "COLUMBIA:CS_BA:CORE",
          label: "Computer Science core",
          needCourses: 5,
          eligible: ["COMS W1004", "COMS W3157", "COMS W3203", "COMS W3261", "CSEE W3827"].map(cid),
          allowDoubleCount: [],
          source: src(BULLETIN,
            "COMS W1004 PROGRAMMING IN JAVA or COMS W1007 Sophomore Year COMS W3134 Data Structures in Java or COMS W3137 HONORS DATA STRUCTURES \uff06 ALGOL COMS W3157 ADVANCED PROGRAMMING COMS W3203 DISCRETE MATHEMATICS Junior and Senior Year Complete the remaining required core courses: COMS W3261 COMPUTER SCIENCE THEORY CSEE W3827 FUNDAMENTALS OF COMPUTER SYSTS",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:DATA_STRUCTURES",
          label: "Data structures",
          needCourses: 1,
          eligible: ["COMS W3134", "COMS W3137"].map(cid),
          allowDoubleCount: [],
          source: src(BULLETIN,
            "COMS W3134 Data Structures in Java or COMS W3137 HONORS DATA STRUCTURES \uff06 ALGOL",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:CALCULUS",
          label: "Calculus",
          needCourses: 1,
          eligible: ["MATH UN1201", "MATH UN1205", "APMA E2000"].map(cid),
          allowDoubleCount: [],
          source: src(BULLETIN,
            "Calculus Requirement: Select one of the following courses: MATH UN1201 CALCULUS III MATH UN1205 ACCELERATED MULTIVARIABLE CALC APMA E2000 MULTV. CALC. FOR ENGI \uff06 APP SCI",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:LINEAR_ALGEBRA",
          label: "Linear algebra",
          needCourses: 1,
          eligible: ["COMS W3251", "MATH UN2010", "MATH UN2015", "MATH UN2020", "APMA E2101", "APMA E3101"].map(cid),
          allowDoubleCount: ["COLUMBIA:CS_BA:PROBABILITY"],
          source: src(BULLETIN,
            "Linear Algebra Requirement: Select one of the following courses: COMS W3251 COMPUTATIONAL LINEAR ALGEBRA (recommended) MATH UN2010 LINEAR ALGEBRA MATH UN2015 Linear Algebra and Probability MATH UN2020 Honors Linear Algebra APMA E2101 INTRO TO APPLIED MATHEMATICS APMA E3101 APPLIED MATH I: LINEAR ALGEBRA",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:PROBABILITY",
          label: "Probability or statistics",
          needCourses: 1,
          eligible: ["MATH UN2015", "IEOR E3658", "STAT UN1201", "STAT GU4001"].map(cid),
          allowDoubleCount: ["COLUMBIA:CS_BA:LINEAR_ALGEBRA"],
          source: src(BULLETIN,
            "Probability / Statistics Requirement: Select one of the following courses: MATH UN2015 Linear Algebra and Probability IEOR E3658 PROBABILITY FOR ENGINEERS STAT UN1201 CALC-BASED INTRO TO STATISTICS STAT GU4001 INTRODUCTION TO PROBABILITY AND STATISTICS",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:AREA_FOUNDATION",
          label: "Area foundation",
          needCourses: 3,
          eligible: AREA_FOUNDATION,
          allowDoubleCount: [],
          source: src(BULLETIN,
            "Area Foundation Courses (9 to 12 points): Select three from the following list:",
            "columbia-cs-bulletin.html"),
        },
        {
          id: "COLUMBIA:CS_BA:CS_ELECTIVE",
          label: "Computer Science elective",
          needCourses: 3,
          eligible: CS_ELECTIVE_ELIGIBLE,
          allowDoubleCount: [],
          source: src(BULLETIN,
            "Any three COMS courses or jointly offered computer science courses such as CSXX or XXCS course (excluding CSER) that are worth at least 3 points and are at the 3000 level or above.",
            "columbia-cs-bulletin.html"),
        },
      ],
    },
  ],
};
