"use client";

import { signIn } from "next-auth/react";

export function GoogleSignIn() {
  return <button onClick={() => signIn("google", { callbackUrl: "/" })} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-medium text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.07]">
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-4 w-4"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.73 7.17l7.36 5.71c4.3-3.97 6.78-9.81 6.78-17.35Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.36-5.71c-2.04 1.37-4.65 2.18-8.54 2.18-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
    Continue with Google
  </button>;
}
