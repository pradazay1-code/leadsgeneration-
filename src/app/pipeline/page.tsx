import { AppShell } from "@/components/AppShell";
import { PipelineWorkspace } from "@/components/PipelineWorkspace";

export const dynamic = "force-dynamic";

export default function PipelinePage() {
  return (
    <AppShell
      title="Pipeline"
      subtitle="Drag leads between stages as deals progress. Every move is logged to the lead's timeline."
    >
      <PipelineWorkspace />
    </AppShell>
  );
}
