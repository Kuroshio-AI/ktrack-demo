import { ShieldAlert, ShieldCheck, ShieldMinus, ShieldX } from "lucide-react";
import { AMS_NAME, IS_AMS } from "@/lib/client";
import { verifyDemoToken } from "@/lib/tokens";
import type { CertificateStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS = {
  Valid: { icon: ShieldCheck, badge: "bg-success", band: "bg-success/[.07]", title: "Valid certificate", detail: "This certificate is current." },
  Expired: { icon: ShieldAlert, badge: "bg-warning", band: "bg-[#fff8e8]", title: "Certificate expired", detail: "This certificate is past its expiry date. Do not rely on it." },
  Revoked: { icon: ShieldX, badge: "bg-danger", band: "bg-[#fff5f5]", title: "Certificate revoked", detail: "This certificate has been withdrawn. Do not rely on it." },
  Superseded: { icon: ShieldMinus, badge: "bg-warning", band: "bg-[#fff8e8]", title: "Certificate superseded", detail: "A newer certificate replaces this one." },
} satisfies Record<CertificateStatus, unknown>;

// AMS issues inspection reports, not certificates.
const REPORT: Partial<Record<CertificateStatus, { title: string; detail: string }>> = {
  Valid: { title: "Valid inspection report", detail: "This report is current." },
  Expired: { title: "Report expired", detail: "This report is past its validity date. Do not rely on it." },
  Revoked: { title: "Report withdrawn", detail: "This report has been withdrawn. Do not rely on it." },
  Superseded: { title: "Report replaced", detail: "A newer report replaces this one." },
};

const WARRANTY: Partial<Record<CertificateStatus, { title: string; detail: string }>> = {
  Valid: { title: "Valid warranty", detail: "This product warranty is in force." },
  Expired: { title: "Warranty expired", detail: "The warranty period has ended." },
  Revoked: { title: "Warranty revoked", detail: "This warranty has been withdrawn. Do not rely on it." },
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const result = typeof token === "string" ? verifyDemoToken(token, process.env.DEMO_CERT_TOKEN_SECRET ?? "") : { ok: false as const, error: "No token supplied" };
  const warranty = result.ok && result.snapshot.kind === "warranty";
  const tone = result.ok ? { ...STATUS[result.snapshot.status], ...(warranty ? WARRANTY[result.snapshot.status] : IS_AMS ? REPORT[result.snapshot.status] : {}) } : { icon: ShieldX, badge: "bg-danger", band: "bg-[#fff5f5]", title: "Cannot verify", detail: result.error };
  const Icon = tone.icon;
  return <main className="min-h-screen bg-[#f3f7f9] px-4 py-10 sm:py-14">
    <div className="animate-rise mx-auto max-w-md overflow-hidden rounded-2xl border border-[#d4e1e8] bg-white shadow-panel">
      <div className={`px-6 pb-8 pt-7 text-center ${tone.band}`}>
        <div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#1684ab]">{IS_AMS ? AMS_NAME : "Kee Safety"} · KTrack</div>
        <span className={`pop-in mx-auto mt-7 grid size-24 place-items-center rounded-full text-white shadow-lg ring-8 ring-white ${tone.badge}`}><Icon className="size-12" aria-hidden="true" /></span>
        <h1 className="mt-5 text-3xl font-bold tracking-[-.03em] text-[#0b3151]">{tone.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{tone.detail}</p>
      </div>
      {result.ok && <div className="px-6 py-6">
        <div className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty ? "Warranty number" : IS_AMS ? "Report number" : "Certificate number"}</div>
        <div className="mt-1 break-all font-mono text-xl font-bold text-[#0b3151]">{result.snapshot.certificateNo}</div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[#e1e9ee] pt-5">
          <div className="col-span-2"><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{IS_AMS ? "Job" : "Asset"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{result.snapshot.assetRef} · {result.snapshot.assetType}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty ? "Warranty date" : "Issued"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{formatDate(result.snapshot.issuedDate)}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-[.1em] text-slate-500">{warranty || IS_AMS ? "Valid until" : "Expires"}</dt><dd className="mt-1 font-semibold text-[#0b3151]">{formatDate(result.snapshot.expiryDate)}</dd></div>
        </dl>
        {/* Rendered on the server, so the snapshot time is stated in UTC rather than guessing the viewer's zone. */}
        <p className="mt-6 border-t border-[#e1e9ee] pt-4 text-xs leading-relaxed text-slate-500">Demo {warranty ? "warranty" : IS_AMS ? "report" : "certificate"} · status as of {formatDate(result.snapshot.asOf.slice(0, 10))}, {result.snapshot.asOf.slice(11, 16)} UTC. This is a signed snapshot, not live certification.</p>
      </div>}
    </div>
  </main>;
}
