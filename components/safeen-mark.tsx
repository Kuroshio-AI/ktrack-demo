// A hull riding a swell line: drawn for the SAFEEN build rather than a letter in a box.
export function SafeenMark({ className = "size-6" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 13h14l-2.5 4h-9z" fill="currentColor" stroke="none" /><path d="M9 13V9h5l2 4" /><path d="M2 20c2 0 2-1.2 4-1.2s2 1.2 4 1.2 2-1.2 4-1.2 2 1.2 4 1.2 2-1.2 4-1.2" /></svg>;
}
