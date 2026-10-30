import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { AMS_NAME, IS_TRIAL } from "@/lib/client";

export const metadata: Metadata = { title: "Sign in · KTrack" };

// Trial only: accounts are made for each person, so there is no sign-up or reset link here.
export default function SignInPage() {
  if (!IS_TRIAL) notFound();
  return <main className="grid min-h-screen place-items-center bg-[#0b3151] px-4 py-10">
    <div className="w-full max-w-[380px]">
      <div className="mb-8 flex items-center gap-3 text-white">
        <span className="grid size-11 place-items-center rounded-xl bg-white text-[#0b3151] shadow-lg"><span className="text-xl font-black">K</span></span>
        <span><span className="block text-xl font-bold tracking-[-.03em]">KTrack</span><span className="block text-[10px] font-bold uppercase tracking-[.15em] text-[#a8c7dd]">{AMS_NAME}</span></span>
      </div>
      <SignInForm />
    </div>
  </main>;
}
