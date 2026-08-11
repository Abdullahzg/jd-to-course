import { PlanScreen } from "@/components/planner/plan-screen";
import { RequireAuth } from "@/components/require-auth";

export const metadata = { title: "Your course path" };

export default function Page() {
  return (
    <main className="min-h-screen">
      <RequireAuth><PlanScreen /></RequireAuth>
    </main>
  );
}
