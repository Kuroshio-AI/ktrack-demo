import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const OTHER = "__other";

// A job's or a login's customer, picked from the list so the two match: a customer login sees only jobs with its own
// customer. "Other customer…" types a name not on the list yet.
export function CustomerSelect({ id, value, choices, onChange }: { id: string; value: string; choices: string[]; onChange: (value: string) => void }) {
  const [other, setOther] = useState(false);
  return <>
    <Select id={id} className="mt-1.5" required value={other ? OTHER : value} onChange={(event) => { const picked = event.target.value; setOther(picked === OTHER); onChange(picked === OTHER ? "" : picked); }}>
      <option value="" disabled>Choose a customer…</option>
      {choices.map((name) => <option key={name}>{name}</option>)}
      <option value={OTHER}>Other customer…</option>
    </Select>
    {other && <Input className="mt-2" aria-label="Customer name" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Customer name…" autoComplete="off" required autoFocus />}
  </>;
}
