"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KanbanSquare, ListTodo, Map, Radar, Settings, Sun, Target, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Today", icon: Sun, exact: false },
  { href: "/", label: "Leads", icon: Target, exact: true },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare, exact: false },
  { href: "/tasks", label: "Tasks", icon: ListTodo, exact: false },
  { href: "/sequences", label: "Sequences", icon: Zap, exact: false },
  { href: "/territories", label: "Territories", icon: Map, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

function NavLinks({ vertical }: { vertical: boolean }) {
  const pathname = usePathname();

  return (
    <>
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors focus-ring",
              vertical ? "px-3 py-2" : "px-3 py-1.5",
              active
                ? "bg-surface-3 text-ink"
                : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </>
  );
}

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/25">
        <Radar className="size-[18px]" strokeWidth={2.25} />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink">LeadSignal</div>
        <div className="text-[11px] text-ink-3">Junk removal · Real estate</div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <>
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className="px-2 pb-5">
          <Wordmark />
        </div>
        <nav className="flex flex-col gap-1">
          <NavLinks vertical />
        </nav>
        <div className="mt-auto rounded-lg border border-line bg-surface-2 p-3">
          <p className="text-[11px] leading-relaxed text-ink-3">
            Scans run automatically every morning. Higher score means newer business with a
            thinner online footprint.
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex flex-col gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur lg:hidden">
        <Wordmark />
        <nav className="flex gap-1 overflow-x-auto">
          <NavLinks vertical={false} />
        </nav>
      </header>
    </>
  );
}
