import { AppHeader } from "@/components/planner/app-header";
import { PlanScreen } from "@/components/planner/plan-screen";

export const metadata = { title: "Your course path" };

export default function Page() {
  return (
    <main className="min-h-screen">
      <AppHeader />
      <PlanScreen />
    </main>
  );
}
