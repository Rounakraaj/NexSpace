"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react";

export function AcceptInvitation({ token, email }: { token: string; email: string | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Could not accept this invitation.");
      router.push("/dashboard");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not accept this invitation."); setBusy(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-zinc-100"><section className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#111116] p-7"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><MailCheck size={18} /></div><p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Workspace invitation</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">You’re invited to collaborate.</h1><p className="mt-2 text-sm leading-6 text-zinc-500">Accept this invitation while signed in as <span className="text-zinc-300">{email || "your account"}</span>. The invitation can only be used once.</p>{error && <p role="alert" className="mt-4 text-xs text-rose-300">{error}</p>}<button onClick={() => void accept()} disabled={busy} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-500 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <>Accept invitation <ArrowRight size={14} /></>}</button></section></main>;
}
