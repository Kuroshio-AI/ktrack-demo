import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HIDDEN_VIEWS } from "@/lib/client";

export default async function ViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (HIDDEN_VIEWS.includes(view)) redirect("/dashboard");
  return <AppShell initialView={view} />;
}
