"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS: Record<number, string> = {
  401: "That email and password don't match an account.",
  403: "That email and password don't match an account.",
  429: "Too many attempts. Wait a minute, then try again.",
};

export function SignInForm() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setPending(true);
    setError(undefined);
    const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: String(form.get("email")).trim(), password: form.get("password"), rememberMe: true }) }).catch(() => undefined);
    // A full load, so the workspace opens as this account.
    if (response?.ok) { window.location.replace("/dashboard"); return; }
    setPending(false);
    setError(!response ? "Signing in needs the internet. Connect, then try again." : ERRORS[response.status] ?? "Signing in didn't work. Try again.");
    // Back to the password, ready to retype.
    element.querySelector<HTMLInputElement>("#password")?.select();
  };
  return <form onSubmit={submit} className="rounded-xl bg-white p-6 shadow-xl sm:p-7">
    <h1 className="text-xl font-bold tracking-[-.02em] text-navy">Sign in</h1>
    <p className="mt-1 text-sm text-slate-600">Use the email and password Kuroshio gave you.</p>
    <div className="mt-6 flex flex-col gap-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" inputMode="email" autoComplete="username" spellCheck={false} required autoFocus /></div>
    <div className="mt-4 flex flex-col gap-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
    <p role="alert" className="mt-4 min-h-5 text-sm text-danger">{error}</p>
    <Button type="submit" className="press mt-2 w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
  </form>;
}
