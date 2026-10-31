"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { CustomerSelect } from "@/components/customer-select";
import { useCopyToClipboard } from "@/components/interior/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AMS_NAME } from "@/lib/client";
import { customerChoices } from "@/lib/customer";
import type { TrialUser } from "@/lib/sync";
import { PASSWORD_MIN, readablePassword } from "@/lib/utils";

type Account = TrialUser;
type Issued = { name: string; email: string; password: string; added: boolean };

// Accounts live only on the server, so this page needs a connection; the server also checks the caller is an Admin.
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init).catch(() => undefined);
  if (!response) throw new Error("Accounts need a connection. Try again once online.");
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "The server didn't answer. Try again.");
  return body as T;
}
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

const JSON_HEADERS = { "content-type": "application/json" };
// Typed in plain text, since the Admin reads it out or pastes it to the person, and kept away from the browser's saved
// passwords, which would otherwise take it for the Admin's own.
const passwordProps = { type: "text", className: "tally-mono mt-1.5", minLength: PASSWORD_MIN, maxLength: 128, required: true, autoComplete: "off", autoCapitalize: "none", spellCheck: false } as const;

// The Admin's sign-in list: add a customer's login, set a new password for anyone else, remove a customer's login. The
// Admin sets each password (KTrack suggests one) and sends it on; KTrack sends no email.
export function AccountsView() {
  const { state, user } = useApp();
  const [accounts, setAccounts] = useState<Account[]>();
  const [form, setForm] = useState(() => ({ name: "", email: "", customer: "", password: readablePassword() }));
  const [round, setRound] = useState(0);
  const [changing, setChanging] = useState<{ id: string; password: string }>();
  const [busy, setBusy] = useState<string>();
  const [issued, setIssued] = useState<Issued>();
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState("");
  const { copy, copied } = useCopyToClipboard();
  useEffect(() => { call<{ accounts: Account[] }>("/api/accounts").then((body) => setAccounts(body.accounts), (reason) => setError(message(reason))); }, []);
  const companies = customerChoices((accounts ?? []).flatMap((account) => account.customer ? [account.customer] : []), state.records.map((record) => record.owner));
  const set = (field: "name" | "email" | "password") => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key); setError("");
    try { await action(); } catch (reason) { setError(message(reason)); } finally { setBusy(undefined); }
  }
  const add = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void run("add", async () => {
    const body = await call<{ account: Account }>("/api/accounts", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(form) });
    setAccounts((current) => [...(current ?? []), body.account]);
    setIssued({ name: body.account.name, email: body.account.email, password: form.password, added: true });
    setSaved(body.account.id);
    setForm({ name: "", email: "", customer: "", password: readablePassword() });
    setRound((current) => current + 1);
  }); };
  const savePassword = (event: FormEvent<HTMLFormElement>, account: Account) => { event.preventDefault(); const password = changing?.password ?? ""; void run(account.id, async () => {
    await call(`/api/accounts/${account.id}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ password }) });
    setIssued({ name: account.name, email: account.email, password, added: false });
    setSaved(account.id);
    setChanging(undefined);
  }); };
  const remove = (account: Account) => { if (window.confirm(`Remove ${account.name}'s login (${account.email})? Their jobs and reports stay; they just can't sign in.`)) void run(account.id, async () => {
    await call(`/api/accounts/${account.id}`, { method: "DELETE" });
    setAccounts((current) => current?.filter((item) => item.id !== account.id));
    setIssued((current) => current?.email === account.email ? undefined : current);
  }); };
  const details = issued && `Sign in to ${AMS_NAME} KTrack at ${window.location.origin}/sign-in\nEmail: ${issued.email}\nPassword: ${issued.password}`;

  return <div className="flex flex-col gap-5">
    {issued && <div role="status" className="animate-rise flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[#bfe0cd] bg-[#f1f9f4] p-4">
      <div className="min-w-0">
        <div className="eyebrow">{issued.added ? "Login added" : "Password changed"}</div>
        <p className="mt-1 text-sm text-slate-700">{issued.name} signs in with <strong className="break-all">{issued.email}</strong> and this password. Send it to them yourself; it isn&apos;t shown again.</p>
        <div className="tally-mono mt-2 select-all break-all text-xl font-bold tracking-wide text-navy">{issued.password}</div>
      </div>
      <div className="flex gap-2"><Button size="sm" variant="outline" className="press" onClick={() => void copy(details!)}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? "Copied" : "Copy sign-in details"}</Button><Button size="sm" variant="ghost" onClick={() => setIssued(undefined)}>Done</Button></div>
    </div>}

    <Card><CardHeader><div className="eyebrow">Customer portal</div><CardTitle>Add a customer login</CardTitle></CardHeader>
      <CardContent><form onSubmit={add} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div><label className="eyebrow" htmlFor="account-name">Name</label><Input id="account-name" className="mt-1.5" value={form.name} onChange={set("name")} placeholder="Their name…" autoComplete="off" required /></div>
        <div><label className="eyebrow" htmlFor="account-email">Email</label><Input id="account-email" type="email" className="mt-1.5" value={form.email} onChange={set("email")} placeholder="name@company.com…" autoComplete="off" spellCheck={false} required /></div>
        <div><label className="eyebrow" htmlFor="account-customer">Company</label><CustomerSelect key={round} id="account-customer" value={form.customer} choices={companies} onChange={(customer) => setForm((current) => ({ ...current, customer }))} /></div>
        <div><label className="eyebrow" htmlFor="account-password">Password</label><Input id="account-password" {...passwordProps} value={form.password} onChange={set("password")} aria-describedby="account-password-hint" /></div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-full">
          <p id="account-password-hint" className="text-xs text-slate-500">KTrack suggests a password; type over it to set your own, at least {PASSWORD_MIN} characters. They see only jobs whose Customer is this company. Staff logins come from Kuroshio.</p>
          <Button type="submit" className="press" disabled={busy === "add"}><Plus data-icon="inline-start" />{busy === "add" ? "Adding…" : "Add login"}</Button>
        </div>
      </form></CardContent>
    </Card>

    {error && <p role="alert" className="text-sm text-danger">{error}</p>}

    <Card><CardHeader><div className="eyebrow">Sign-in</div><CardTitle>{accounts ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}` : "Accounts"}</CardTitle></CardHeader>
      <CardContent>
        {!accounts && !error && <p className="text-sm text-slate-500">Loading accounts…</p>}
        {accounts && <ul className="divide-y divide-line rounded-xl border border-line">{accounts.map((account) => <li key={account.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${saved === account.id ? "row-glow" : ""}`}>
          <div className="min-w-[180px] flex-1"><div className="font-semibold text-navy">{account.name}{account.id === user?.id && <span className="ml-2 text-xs font-normal text-slate-500">You</span>}</div><div className="break-all text-xs text-slate-500">{account.email}</div></div>
          <div className="flex min-w-0 items-center gap-2"><Badge variant={account.role === "Customer" ? "secondary" : "outline"}>{account.role === "Engineer" ? "Inspector" : account.role}</Badge>{account.customer && <span className="truncate text-sm text-slate-600">{account.customer}</span>}</div>
          <div className="ml-auto flex gap-1">
            {account.id !== user?.id && changing?.id !== account.id && <Button size="sm" variant="ghost" className="press" disabled={Boolean(busy)} onClick={() => { setError(""); setChanging({ id: account.id, password: readablePassword() }); }}><KeyRound data-icon="inline-start" />New password</Button>}
            {account.role === "Customer" && <Button size="sm" variant="ghost" className="press text-danger" disabled={Boolean(busy)} onClick={() => remove(account)}><Trash2 data-icon="inline-start" />Remove</Button>}
          </div>
          {changing?.id === account.id && <form onSubmit={(event) => savePassword(event, account)} onKeyDown={(event) => { if (event.key === "Escape") setChanging(undefined); }} className="flex basis-full flex-wrap items-end gap-3 rounded-lg border border-[#e9c9ae] bg-[#fffaf5] p-3">
            <div className="min-w-[220px] flex-1"><label className="eyebrow" htmlFor={`password-${account.id}`}>New password for {account.name}</label><Input id={`password-${account.id}`} {...passwordProps} value={changing.password} onChange={(event) => setChanging({ id: account.id, password: event.target.value })} autoFocus /></div>
            <div className="flex gap-1"><Button type="submit" size="sm" className="press" disabled={busy === account.id}>{busy === account.id ? "Saving…" : "Save password"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setChanging(undefined)}>Cancel</Button></div>
            <p className="basis-full text-xs text-slate-500">KTrack suggests one; type over it to set your own. Their old password stops working and they&apos;re signed out on every device.</p>
          </form>}
        </li>)}</ul>}
      </CardContent>
    </Card>
  </div>;
}
