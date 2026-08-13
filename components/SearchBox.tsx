"use client";

// Ticker search with debounced suggestions. Selecting a result opens the
// full analysis page for that symbol.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export default function SearchBox() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function onChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 1) {
      setHits([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { results?: Hit[] };
        setHits(json.results ?? []);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function go(symbol: string) {
    setOpen(false);
    setQuery("");
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  return (
    <div className="searchbox" ref={boxRef}>
      <input
        type="search"
        value={query}
        placeholder="Search any stock… (AAPL, Tesla, …)"
        aria-label="Search stocks"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            go(hits[0]?.symbol ?? query.trim().toUpperCase());
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <div className="search-results">
          {loading && hits.length === 0 && <div className="search-empty">Searching…</div>}
          {!loading && hits.length === 0 && <div className="search-empty">No matches</div>}
          {hits.map((h) => (
            <button key={h.symbol} className="search-hit" onClick={() => go(h.symbol)}>
              <span className="hit-sym">{h.symbol}</span>
              <span className="hit-name">{h.name}</span>
              <span className="hit-exch">{h.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
