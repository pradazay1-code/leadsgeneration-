import { AppShell } from "@/components/AppShell";
import { TerritoryManager } from "@/components/TerritoryManager";

export const dynamic = "force-dynamic";

export default function TerritoriesPage() {
  return (
    <AppShell
      title="Territories"
      subtitle="The towns the scanner sweeps every morning. Add the areas you actually sell into."
    >
      <TerritoryManager />
    </AppShell>
  );
}
