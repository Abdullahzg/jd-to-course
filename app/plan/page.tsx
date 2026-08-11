import { PlanScreen } from "@/components/planner/plan-screen";

export const metadata = { title: "Your course path" };

export default function Page() {
  return (
    <main className="min-h-screen">
      <PlanScreen />
    </main>
  );
}
