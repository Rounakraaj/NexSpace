import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { env, isDatabaseConfigured } from "@/lib/env";
import { AuthForms } from "./auth-forms";

export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const params = await searchParams;
  const candidate = params.callbackUrl ?? "/dashboard";
  const callbackUrl = candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\") ? candidate : "/dashboard";
  const googleReady = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const ready = isDatabaseConfigured() && Boolean(env.NEXTAUTH_SECRET ?? env.AUTH_SECRET);
  return (
    <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-zinc-100">
      <section className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#111116] p-7 shadow-2xl shadow-black/40">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-zinc-500 transition hover:text-zinc-200"><ArrowLeft size={13} /> Back to NexSpace</Link>
        <div className="mt-8 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-600 shadow-lg shadow-violet-950/50"><Sparkles size={18} /></div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">NexSpace account</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Think together.</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Sign in securely to create a workspace and collaborate with your team.</p>
        {ready ? <AuthForms googleReady={googleReady} callbackUrl={callbackUrl} /> : <div role="status" className="mt-6 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/80">Account sign-in requires PostgreSQL connection URLs and an Auth.js secret. Add them to your environment to continue.</div>}
      </section>
    </main>
  );
}
