import { AppShell } from "@/components/AppShell";
import { SettingsPanel } from "@/components/SettingsPanel";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <AppShell
      title="Settings"
      subtitle="Connection status, scan history, and how leads get scored."
    >
      <SettingsPanel />
    </AppShell>
  );
}
