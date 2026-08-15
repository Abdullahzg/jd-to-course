"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Course, Plan, Program, Term } from "@/lib/types";
import { verifyPlan } from "@/lib/verify";

/**
 * The repair room. Dropping a course used to gamble the whole board: if the
 * solver could not rebuild, you got an error screen, no undo, no say. Now a
 * breaking change keeps the old plan, opens this view instead, and hands
 * you the semesters directly: every term shows its credits against the
 * program's floor and ceiling, every term has a search to add or remove
 * courses, and every edit re-runs the rule checks live. Nothing commits
 * until the arrangement passes review, and closing loses nothing.
 */

type RepairInfo = {
  attempted: string;
  message: string;
  blockingBuckets: { bucketId: string; label: string; detail: string }[];
  suggestions: string[];
  dropCourseId?: string;
};

const HOW: Record<string, string> = {
  "credit-cap": "Remove or move a course out of that semester; the search box in a lighter semester will take it.",
  "full-time": "Add a course to that semester with its search box until it reaches the floor.",
  prereqs: "Move the prerequisite to an earlier semester, or add it there if it is missing.",
  offered: "Move the course to a semester it actually runs in; its terms are printed on the row.",
  horizon: "Everything must fit the semesters you have; remove something or plan a longer horizon from the survey.",
  "no-duplicates": "Remove one of the copies.",
  "no-retakes": "You already passed it; remove it and pick something new.",
  "single-count": "One of these requirements needs a different course; add one from the requirement's list.",
  citations: "A data problem on our side, not yours; nothing you place can fix or cause this.",
};

export function PlanDoctor({
  plan, program, courses, catalog, names, termKinds, completed, repair, busy,
  onClose, onApply, onJump,
}: {
  plan: Plan;
  program: Program;
  courses: Map<string, Course>;
  catalog: Course[];
  names: string[];
  termKinds: Term[];
  completed: string[];
  repair: RepairInfo | null;
  busy: boolean;
  onClose: () => void;
  onApply: (placements: { courseId: string; term: number }[], dropId?: string) => void;
  onJump: (courseId: string) => void;
}) {
  const [draft, setDraft] = useState<{ courseId: string; term: number }[]>(() =>
    plan.placements
      .filter((p) => p.courseId !== repair?.dropCourseId)
      .map((p) => ({ courseId: p.courseId, term: p.term })));
  const [queries, setQueries] = useState<Record<number, string>>({});

  const draftPlan = useMemo(() => {
    const termCredits = names.map((_, t) =>
      draft.filter((d) => d.term === t).reduce((s, d) => s + (courses.get(d.courseId)?.credits ?? 0), 0));
    return { ...plan, placements: draft.map((d) => ({ ...plan.placements.find((p) => p.courseId === d.courseId) ?? { courseId: d.courseId, bucketId: "", covers: [] }, term: d.term })), termCredits } as Plan;
  }, [draft, plan, names, courses]);

  const v = useMemo(
    () => verifyPlan(draftPlan, program, courses, completed, termKinds),
    [draftPlan, program, courses, completed, termKinds]);
  const failed = v.checks.filter((c) => !c.passed);

  // Requirement arithmetic against the program's own pools, live.
  const reqStatus = useMemo(() => {
    const inDraft = new Set(draft.map((d) => d.courseId));
    const done = new Set(completed);
    return program.buckets.map((b) => {
      const has = b.eligible.filter((id) => inDraft.has(id) || done.has(id));
      const needC = b.needCourses ?? null;
      const needCr = b.needCredits ?? null;
      const credits = has.reduce((s, id) => s + (courses.get(id)?.credits ?? 0), 0);
      const ok = needC != null ? has.length >= needC : needCr != null ? credits >= needCr : true;
      const gap = needC != null ? Math.max(0, needC - has.length) : needCr != null ? Math.max(0, needCr - credits) : 0;
      return { id: b.id, label: b.label, ok, gap, unit: needC != null ? "course" : "credit" };
    });
  }, [draft, program, completed, courses]);

  const chip = (t: number) => {
    const cr = draftPlan.termCredits[t] ?? 0;
    if (cr > program.maxCreditsPerTerm) return { text: `over by ${cr - program.maxCreditsPerTerm} cr`, tone: "#b91c1c" };
    if (cr < program.minCreditsPerTerm) return { text: `${program.minCreditsPerTerm - cr} cr below full-time; electives can fill it`, tone: "var(--amber-deep, #92400e)" };
    return { text: "ok", tone: "var(--teal)" };
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="my-6 w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {repair ? `${repair.attempted} does not fit on its own` : "Arrange the board by hand"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {repair
                ? `${repair.message} Your current plan is untouched; fix the arrangement here and apply it, or close and keep things as they were.`
                : "Every edit below is checked live against the degree's rules. Nothing commits until you apply."}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close, keep the old plan"
                  className="rounded-full p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {/* live verdicts: rules first, then requirements */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Rule checks · {v.checks.length - failed.length} of {v.checks.length} green</p>
            <ul className="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto">
              {failed.map((c) => (
                <li key={c.id} className="text-xs">
                  <p className="font-medium" style={{ color: "#b91c1c" }}>{c.rule}</p>
                  <p className="text-muted-foreground">{c.detail}</p>
                  <p className="text-muted-foreground"><strong>How to fix:</strong> {HOW[c.id] ?? "Adjust the semesters below until this turns green."}</p>
                  {!!c.offenders.length && (
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {c.offenders.map((id) => {
                        // Semester- or requirement-level failures (a credit
                        // cap, a missing citation) have no course to jump to.
                        const inDraft = draft.find((d) => d.courseId === id);
                        if (!courses.get(id)) {
                          return <span key={id} className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">{id}</span>;
                        }
                        return (
                          <button key={id} onClick={() => { const el = document.getElementById(`doctor-term-${inDraft?.term ?? 0}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                                  className="rounded-full border border-border px-2 py-0.5 text-[10px] hover:border-[var(--blue)]">
                            {courses.get(id)?.code}
                          </button>
                        );
                      })}
                    </p>
                  )}
                </li>
              ))}
              {!failed.length && <li className="text-xs" style={{ color: "var(--teal)" }}>Every rule passes with this arrangement.</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">Degree requirements, live</p>
            <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
              {reqStatus.map((r) => (
                <li key={r.id} className="flex items-baseline gap-1.5 text-xs">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.ok ? "var(--teal)" : "var(--amber)" }} />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{r.ok ? "met" : `${r.gap} ${r.unit}${r.gap === 1 ? "" : "s"} short`}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* the semesters, each with its own search */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {names.map((name, t) => {
            const here = draft.filter((d) => d.term === t);
            const c = chip(t);
            const q = (queries[t] ?? "").trim().toLowerCase();
            const inDraft = new Set(draft.map((d) => d.courseId));
            const doneSet = new Set(completed);
            const matches = q.length < 2 ? [] : catalog
              .filter((x) => !inDraft.has(x.id) && !doneSet.has(x.id))
              .filter((x) => x.termsOffered.includes(termKinds[t]))
              .filter((x) => x.code.toLowerCase().includes(q) || x.title.toLowerCase().includes(q))
              .slice(0, 6);
            return (
              <div key={t} id={`doctor-term-${t}`} className="rounded-xl border border-border p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium">{name}</p>
                  <span className="text-[11px] font-medium tabular-nums" style={{ color: c.tone }}>
                    {draftPlan.termCredits[t] ?? 0} cr · {c.text}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {here.map((d) => {
                    const course = courses.get(d.courseId);
                    return (
                      <li key={d.courseId} className="flex items-center gap-2 text-xs">
                        <button onClick={() => onJump(d.courseId)} className="min-w-0 flex-1 truncate text-left hover:underline" title="See this course on the plan">
                          {course?.title} <span className="code text-[10px] text-muted-foreground">{course?.code}</span>
                        </button>
                        <span className="tabular-nums text-muted-foreground">{course?.credits} cr</span>
                        <button onClick={() => setDraft((xs) => xs.filter((x) => x.courseId !== d.courseId))}
                                aria-label={`Remove ${course?.code}`} className="text-muted-foreground hover:text-red-700">
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                  {!here.length && <li className="text-xs text-muted-foreground">empty semester</li>}
                </ul>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <input value={queries[t] ?? ""} onChange={(e) => setQueries((qs) => ({ ...qs, [t]: e.target.value }))}
                         placeholder="add a course: code or title"
                         className="w-full rounded-lg border border-border py-1.5 pl-7 pr-2 text-xs focus:border-[var(--blue)] focus:outline-none" />
                </div>
                {!!matches.length && (
                  <ul className="mt-1 space-y-0.5 rounded-lg border border-border p-1">
                    {matches.map((m) => (
                      <li key={m.id}>
                        <button onClick={() => { setDraft((xs) => [...xs, { courseId: m.id, term: t }]); setQueries((qs) => ({ ...qs, [t]: "" })); }}
                                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--blue-soft)]">
                          <span className="min-w-0 flex-1 truncate">{m.title}</span>
                          <span className="code text-[10px] text-muted-foreground">{m.code}</span>
                          <span className="tabular-nums text-[10px] text-muted-foreground">{m.credits} cr</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={() => onApply(draft, repair?.dropCourseId)} disabled={busy}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
            {busy ? "Checking with the solver" : "Apply this arrangement"}
          </button>
          <button onClick={onClose} className="rounded-full border border-border px-5 py-2 text-sm">
            Keep the old plan
          </button>
          {repair?.dropCourseId && (
            <span className="text-[11px] text-muted-foreground">
              Applying keeps {courses.get(repair.dropCourseId)?.code ?? "the dropped course"} out.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
