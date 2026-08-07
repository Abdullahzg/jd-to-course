import { Landing } from "@/components/planner/landing";
import { SCHOOLS } from "@/data";

export default function Page() {
  return (
    <Landing
      schools={SCHOOLS.map((s) => ({ shortName: s.shortName, totalCredits: s.programs[0]?.totalCredits ?? 0 }))}
      courseCount={SCHOOLS.reduce((n, s) => n + s.courses.length, 0)}
      ruleCount={SCHOOLS.reduce((n, s) => n + s.programs.reduce((m, p) => m + p.buckets.length, 0), 0)}
    />
  );
}
