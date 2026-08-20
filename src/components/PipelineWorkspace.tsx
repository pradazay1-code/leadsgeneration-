"use client";

import { useCallback, useState } from "react";
import type { Lead, LeadStatus } from "@/lib/types";
import { LeadDrawer } from "./LeadDrawer";
import { PipelineBoard } from "./PipelineBoard";

/**
 * Board plus the shared lead drawer, so a card can be opened without leaving
 * the pipeline view.
 */
export function PipelineWorkspace() {
  const [selected, setSelected] = useState<Lead | null>(null);
  const [version, setVersion] = useState(0);

  const patchLead = useCallback(
    async (id: string, patch: { status?: LeadStatus; notes?: string }) => {
      setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
      await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setVersion((v) => v + 1);
    },
    [],
  );

  const deleteLead = useCallback(async (id: string) => {
    await fetch(`/api/leads/${id}`, { method: "DELETE" });
    setVersion((v) => v + 1);
  }, []);

  return (
    <>
      <PipelineBoard key={version} onOpenLead={setSelected} />
      {selected ? (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onPatch={patchLead}
          onDelete={deleteLead}
        />
      ) : null}
    </>
  );
}
