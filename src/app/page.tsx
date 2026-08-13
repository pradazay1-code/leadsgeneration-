import { AppShell } from "@/components/AppShell";
import { LeadsWorkspace } from "@/components/LeadsWorkspace";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return (
    <AppShell
      title="Leads"
      subtitle="Newer junk removal and real estate businesses with the thinnest online footprint, scored highest first."
    >
      <LeadsWorkspace />
    </AppShell>
  );
}
