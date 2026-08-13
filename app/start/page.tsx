import { Survey } from "@/components/planner/survey";
import { PRELOADED_JDS, SCHOOLS, DEMO_STUDENT } from "@/data";
import { RequireAuth } from "@/components/require-auth";

export const metadata = { title: "Set up your plan" };

export default function Page() {
  return (
    <RequireAuth>
    <Survey
      jds={PRELOADED_JDS}
      demos={{ COLUMBIA: DEMO_STUDENT }}
      schools={SCHOOLS.map((s) => ({
        id: s.id, shortName: s.shortName, name: s.name,
        structureNote: s.structureNote, courseCount: s.courses.length,
        programs: s.programs.map((p) => ({
          id: p.id, name: p.name, totalCredits: p.totalCredits, majorCredits: p.majorCredits,
          maxCreditsPerTerm: p.maxCreditsPerTerm, minCreditsPerTerm: p.minCreditsPerTerm,
          bucketCount: p.buckets.length,
          // Which courses this degree is actually built from, so the course
          // picker can lead with them instead of the alphabet.
          coreIds: [...new Set(p.buckets.flatMap((b) => b.eligible))],
        })),
      }))}
    />
    </RequireAuth>
  );
}
