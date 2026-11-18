"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export function AuthForms({ googleReady, callbackUrl = "/dashboard" }: { googleReady: boolean; callbackUrl?: string }) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "register") {
        const response = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email, password }) });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setMessage(data.message ?? "We could not create your account.");
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false, callbackUrl });
      if (result?.error) {
        setMessage(mode === "signin" ? "Email or password did not match." : "We could not sign you in. If you already have an account, try signing in instead.");
        return;
      }
      router.push(callbackUrl);
    } catch {
      setMessage(mode === "signin" ? "Sign-in is temporarily unavailable. Please try again." : "Registration is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <form onSubmit={submit} className="mt-6 space-y-3">
      {mode === "register" && <label className="block text-xs text-zinc-400">Your name<input name="name" required minLength={2} maxLength={80} autoComplete="name" className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/50" /></label>}
      <label className="block text-xs text-zinc-400">Email<input name="email" type="email" required maxLength={254} autoComplete="email" className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/50" /></label>
      <label className="block text-xs text-zinc-400">Password<input name="password" type="password" required minLength={mode === "register" ? 10 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/50" />{mode === "register" && <span className="mt-1 block text-[10px] text-zinc-600">Use at least 10 characters and include a number.</span>}</label>
      {message && <p role="alert" className="text-xs text-rose-300">{message}</p>}
      <button disabled={busy} className="h-10 w-full rounded-lg bg-violet-500 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-50">{busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}</button>
    </form>
    <button onClick={() => { setMode(mode === "signin" ? "register" : "signin"); setMessage(""); }} className="mt-4 w-full text-xs text-zinc-500 hover:text-zinc-200">{mode === "signin" ? "New to NexSpace? Create an account" : "Already have an account? Sign in"}</button>
    {googleReady && <><div className="my-5 flex items-center gap-3 text-[10px] text-zinc-700"><span className="h-px flex-1 bg-white/[0.08]" />OR<span className="h-px flex-1 bg-white/[0.08]" /></div><button onClick={() => signIn("google", { callbackUrl })} className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.04] text-sm text-zinc-200 hover:bg-white/[0.07]">Continue with Google</button></>}
  </>;
}
