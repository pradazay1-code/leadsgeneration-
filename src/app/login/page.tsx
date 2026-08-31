"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Radar } from "lucide-react";
import { Button, Label, Spinner, inputClass } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "Incorrect password");
        return;
      }
      // Only ever redirect to a same-origin path.
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-brand/15 text-brand ring-1 ring-brand/25">
          <Radar className="size-5" strokeWidth={2.25} />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-ink">LeadSignal</h1>
          <p className="text-[12px] text-ink-3">Enter your password to continue</p>
        </div>
      </div>

      <Label htmlFor="password">Password</Label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
        autoFocus
        autoComplete="current-password"
        required
      />

      {error ? <p className="mt-3 text-[13px] text-red-400">{error}</p> : null}

      <Button type="submit" variant="primary" className="mt-5 w-full" disabled={busy || !password}>
        {busy ? <Spinner /> : null}
        Sign in
      </Button>
    </form>
  );
}

/**
 * Build stamp, shown before sign-in.
 *
 * Fetched rather than rendered server-side because this page is static, so a
 * build-time value would be baked into the cached HTML — exactly the staleness
 * this is meant to detect.
 */
function BuildStamp() {
  const [info, setInfo] = useState<{ commit: string; branch: string } | null>(null);

  useEffect(() => {
    fetch("/api/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? setInfo({ commit: d.commit, branch: d.branch }) : null))
      .catch(() => {});
  }, []);

  if (!info) return null;
  return (
    <p className="mt-6 text-center font-mono text-[10px] text-ink-3">
      {info.commit} · {info.branch}
    </p>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <Suspense fallback={<div className="text-sm text-ink-3">Loading…</div>}>
        <LoginForm />
      </Suspense>
      <BuildStamp />
    </main>
  );
}
