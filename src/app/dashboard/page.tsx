import { AppShell } from "@/components/AppShell";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <AppShell title="Today" subtitle="What needs doing, and where the pipeline stands.">
      <Dashboard />
    </AppShell>
  );
}
