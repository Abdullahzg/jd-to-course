"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Undo2, X } from "lucide-react";
import type { Plan } from "@/lib/types";
import { usePlanner } from "./planner-store";
import { RichText } from "./rich-text";
import { useBudget } from "@/components/budget/budget-provider";

type Patch = {
  kind: "exclude" | "lock" | "horizon";
  courseIds: string[];
  term: number | null;
  horizonTerms: number | null;
  label: string;
};

type Turn = { role: "you" | "it"; text: string; patch?: Patch | null };

/**
 * Ask about the plan, in a panel big enough to read.
 *
 * The old version was a 23rem box in the corner with 11px type, which is a hard
 * thing to read and a harder thing to trust. This one slides in at a proper
 * width, says plainly what it can and cannot do, and renders any change it
 * proposes as a confirm button rather than as a claim. It never states a plan:
 * it hands a constraint to the solver and the page shows the solver's answer.
 */
export function AskPanel({ plan }: { plan: Plan }) {
  const { state, courses, solveWith } = usePlanner();
  const { refresh, noteSpend } = useBudget();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "you", text: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          plan: {
            semesters: plan.termCredits.length,
            // "Why is this course here" was the most obvious question anyone
            // would ask, and the panel used to be sent only the what: a title,
            // a term, a list of skill names. So it answered "I can only tell
            // you what is in your plan, not why", which is a refusal the solver
            // had already done the work to make unnecessary. Everything below
            // is the reasoning the solver produced.
            placements: plan.placements.map((p) => ({
              courseId: p.courseId,
              code: courses.get(p.courseId)?.code,
              title: courses.get(p.courseId)?.title,
              semester: p.term + 1,
              credits: courses.get(p.courseId)?.credits,
              countsToward: plan.buckets.find((b) => b.bucketId === p.bucketId)?.label ?? "nothing on its own",
              whyItIsInThePlan: p.covers.length
                ? "the degree requires this slot, and this course was chosen to fill it because it also answers the posting"
                : "the degree requires it, whatever job you are aiming at",
              answersFromThePosting: p.covers.map((c) => ({
                requirement: c.skill,
                catalogSentenceThatProvesIt: c.evidence,
              })),
              whyThisSemesterAndNotEarlier: p.earliestReason ?? "nothing was holding it back",
              otherCoursesThatFitTheSameSlot: (plan.slotChoices.find((sc) => sc.chosen === p.courseId)?.alternatives ?? [])
                .map((a) => ({
                  title: courses.get(a.courseId)?.title,
                  code: courses.get(a.courseId)?.code,
                  // Both directions. This used to send only deltaSkills under
                  // the name "requirementsItWouldAnswerInstead", so the model
                  // was told every alternative answered the same things as the
                  // course it would replace, with an empty list as the proof.
                  partsOfTheJobItAnswersThatTheChosenOneDoesNot: a.deltaSkills,
                  partsOfTheJobItWouldStopAnswering: a.losesSkills,
                  partsNoOtherPlannedCourseAnswers: a.lossesNoOtherPlannedCourseAnswers,
                  provedInterchangeable: a.sameClass,
                  creditDifference: a.deltaCredits,
                  prerequisiteCreditsItWouldAdd: a.extraPrereqCredits,
                  requirementsItWouldLeaveShort: a.stopsSatisfying,
                })),
              needsAdvisorCheck: p.needsAdvisorCheck,
              pinned: p.locked,
            })),
            requirements: plan.buckets.map((b) => ({
              label: b.label, have: b.fromCompleted + b.fromPlan, need: b.need, done: b.satisfied,
            })),
            teaches: plan.skillsCovered,
            totalCredits: plan.totalCredits,
          },
        }),
      });
      // The answer arrives a few words at a time, so an empty bubble goes up
      // first and fills in. Eight seconds of a cursor blinking feels far longer
      // than eight seconds of a sentence being written.
      setTurns((t) => [...t, { role: "it", text: "" }]);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "delta") {
            const d = String(ev.text ?? "");
            setTurns((t) => {
              const copy = [...t];
              const last = copy[copy.length - 1];
              if (last?.role === "it") copy[copy.length - 1] = { ...last, text: last.text + d };
              return copy;
            });
          } else if (ev.type === "done") {
            noteSpend(Number(ev.costUsd) || 0);
            void refresh();
            setTurns((t) => {
              const copy = [...t];
              const last = copy[copy.length - 1];
              if (last?.role === "it") {
                copy[copy.length - 1] = ev.ok
                  ? { ...last, text: String(ev.reply ?? last.text), patch: (ev.patch as Patch) ?? undefined }
                  : { ...last, text: String(ev.error ?? "That did not work.") };
              }
              return copy;
            });
          }
        }
      }
    } catch {
      setTurns((t) => [...t, { role: "it", text: "Could not reach the model." }]);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (patch: Patch) => {
    let next = { ...state };
    const codes = patch.courseIds.map((id) => courses.get(id)?.code ?? id).join(", ");

    if (patch.kind === "exclude") {
      next = { ...next, student: {
        ...next.student,
        excluded: [...new Set([...next.student.excluded, ...patch.courseIds])],
        locked: next.student.locked.filter((l) => !patch.courseIds.includes(l.courseId)),
      } };
    } else if (patch.kind === "lock" && patch.courseIds[0] && patch.term != null) {
      next = { ...next, student: {
        ...next.student,
        locked: [...next.student.locked.filter((l) => l.courseId !== patch.courseIds[0]),
                 { courseId: patch.courseIds[0], term: patch.term }],
      } };
    } else if (patch.kind === "horizon" && patch.horizonTerms != null) {
      next = { ...next, student: { ...next.student, horizonTerms: patch.horizonTerms } };
    }

    setTurns((t) => [...t, {
      role: "it",
      text: "Done. The solver worked the whole plan out again. The page behind this panel is its answer, not mine. Undo is in the header if you want it back.",
    }]);
    await solveWith(next, undefined, {
      action: patch.kind === "exclude" ? `Removed ${codes}`
        : patch.kind === "lock" ? `Pinned ${codes}`
        : `Changed to ${patch.horizonTerms} semesters`,
      reason: "You asked for this in the chat and confirmed it.",
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full bg-[var(--blue)] px-6 py-4 text-white glow-strong transition-transform hover:scale-[1.04]"
      >
        <MessageCircle className="h-5 w-5" />
        Ask about this plan
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[var(--ink)]/25" onClick={() => setOpen(false)} />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(30rem,100vw)] flex-col bg-white shadow-2xl">
        <header className="shrink-0 border-b border-border p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold">Ask about this plan</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                It can answer questions about the plan on screen, and it can suggest one change
                for you to confirm. It cannot pick your courses. The solver does that, and you
                will see its answer on the page behind this.
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-[var(--blue-soft)] hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          {!turns.length && (
            <>
              <p className="text-sm text-muted-foreground">Try one of these:</p>
              <ul className="space-y-2">
                {[
                  "Why is my last semester so heavy?",
                  "I don't want to take any operating systems course",
                  "What if I had one more semester?",
                  "Which of these actually teach me PyTorch?",
                ].map((s) => (
                  <li key={s}>
                    <button
                      onClick={() => void send(s)}
                      className="w-full rounded-2xl border border-border p-3.5 text-left text-sm transition-all hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {turns.map((t, i) => (
            <div key={i} className={t.role === "you" ? "flex justify-end" : ""}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
                t.role === "you" ? "bg-[var(--blue)] text-white" : "border border-border bg-[var(--blue-soft)]/50"
              }`}>
                {t.role === "you" ? t.text : (
                  t.text
                    ? <RichText text={t.text} />
                    : <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking
                      </span>
                )}
              </div>
              {t.patch && (
                <div className="mt-2.5 rounded-2xl border-2 p-3.5" style={{ borderColor: "var(--blue-light)" }}>
                  <p className="text-sm text-muted-foreground">
                    This would change a rule the solver has to obey. Nothing happens until you say so.
                  </p>
                  <button
                    onClick={() => void apply(t.patch!)}
                    className="mt-2.5 w-full rounded-full bg-[var(--blue)] px-5 py-3 font-medium text-white transition-transform hover:scale-[1.02]"
                  >
                    {t.patch.label}
                  </button>
                  {!!t.patch.courseIds.length && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      {t.patch.courseIds.map((id) => courses.get(id)?.code ?? id).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> reading your plan
            </p>
          )}
          <div ref={endRef} />
        </div>

        <footer className="shrink-0 border-t border-border p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              rows={2}
              placeholder="Ask a question, or say what you do not want"
              className="min-h-0 flex-1 resize-none rounded-2xl border border-border p-3.5 text-[15px] outline-none focus:border-[var(--blue)]"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-full bg-[var(--blue)] p-3.5 text-white transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Undo2 className="h-3 w-3" /> Any change it makes can be undone from the header.
          </p>
        </footer>
      </aside>
    </>
  );
}
