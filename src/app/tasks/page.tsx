import { AppShell } from "@/components/AppShell";
import { TaskList } from "@/components/TaskList";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <AppShell
      title="Tasks"
      subtitle="Every follow-up you've scheduled, soonest first. Overdue work is called out."
    >
      <TaskList />
    </AppShell>
  );
}
