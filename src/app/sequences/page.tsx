import { AppShell } from "@/components/AppShell";
import { SequencesWorkspace } from "@/components/SequencesWorkspace";

export const dynamic = "force-dynamic";

export default function SequencesPage() {
  return (
    <AppShell
      title="Sequences"
      subtitle="Multi-touch cadences. Steps become tasks, or send themselves when a provider is connected."
    >
      <SequencesWorkspace />
    </AppShell>
  );
}
