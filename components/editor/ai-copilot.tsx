"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle, Sparkles, X } from "lucide-react";

type Action = "summarize" | "generate" | "rewrite" | "improve" | "explain" | "brainstorm";
const actions: Array<{ id: Action; label: string }> = [
  { id: "summarize", label: "Summarize" },
  { id: "generate", label: "Generate" },
  { id: "rewrite", label: "Rewrite selection" },
  { id: "improve", label: "Improve writing" },
  { id: "explain", label: "Explain selection" },
  { id: "brainstorm", label: "Brainstorm" },
];

export function AiCopilot({ documentId, selectedText, available, onClose, onInsert }: {
  documentId: string;
  selectedText: string;
  available: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const [action, setAction] = useState<Action>(selectedText ? "improve" : "summarize");
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    setError("");
    setOutput("");
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, selection: selectedText, instruction }),
        signal: requestController.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message ?? "AI request failed.");
      }
      if (!response.body) throw new Error("The response stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setOutput((current) => current + decoder.decode(value, { stream: true }));
      }
      setOutput((current) => current + decoder.decode());
    } catch (cause) {
      if (!requestController.signal.aborted) setError(cause instanceof Error ? cause.message : "AI request failed.");
    } finally {
      if (controller.current === requestController) { controller.current = null; setLoading(false); }
    }
  }

  return <aside aria-label="AI Copilot" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-[#111116] text-zinc-100 shadow-2xl shadow-black/60">
    <div className="flex h-14 items-center gap-2 border-b border-white/[0.07] px-4"><Sparkles size={15} className="text-violet-300" /><h2 className="flex-1 text-sm font-medium">AI Copilot</h2><button type="button" onClick={onClose} aria-label="Close AI Copilot" className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-white"><X size={15} /></button></div>
    {!available ? <div role="status" className="m-4 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] p-3 text-xs leading-5 text-amber-100/80">AI is optional. Add <code>OPENAI_API_KEY</code> to the server environment to enable this panel.</div> : <>
      <div className="grid grid-cols-2 gap-2 p-4">{actions.map((item) => <button key={item.id} type="button" onClick={() => setAction(item.id)} className={`rounded-md border px-2.5 py-2 text-left text-[10px] transition ${action === item.id ? "border-violet-300/30 bg-violet-400/10 text-violet-100" : "border-white/[0.07] text-zinc-400 hover:bg-white/[0.04]"}`}>{item.label}</button>)}</div>
      {selectedText && <div className="mx-4 rounded-md border border-white/[0.07] bg-white/[0.025] p-3"><p className="mb-1 text-[9px] uppercase tracking-wider text-zinc-600">Selected text</p><p className="line-clamp-4 whitespace-pre-wrap text-[10px] leading-5 text-zinc-400">{selectedText}</p></div>}
      <label className="px-4 pt-4 text-[10px] text-zinc-500">What should NexSpace help with?</label><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2000} placeholder={action === "generate" ? "Describe what you want to draft…" : "Add any preferences (optional)…"} className="mx-4 mt-2 min-h-20 resize-y rounded-md border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-5 outline-none focus:border-violet-400/40" />
      <button type="button" onClick={() => void run()} disabled={loading || !available} className="mx-4 mt-3 flex h-9 items-center justify-center gap-2 rounded-md bg-violet-500 text-xs font-medium text-white transition hover:bg-violet-400 disabled:opacity-50">{loading ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />}{loading ? "Thinking…" : "Generate"}</button>
      {error && <p role="alert" className="mx-4 mt-3 text-xs text-rose-300">{error}</p>}
      {output && <div className="mx-4 mt-4 min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/20 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-[9px] uppercase tracking-wider text-violet-300">Draft</p><button type="button" title="Copy draft" aria-label="Copy AI draft" onClick={() => void navigator.clipboard.writeText(output)} className="text-zinc-500 hover:text-zinc-200"><Copy size={12} /></button></div><p className="whitespace-pre-wrap text-xs leading-6 text-zinc-300">{output}</p></div>}
      {output && <button type="button" onClick={() => { onInsert(output); onClose(); }} className="mx-4 mb-4 mt-3 h-9 rounded-md border border-white/10 text-xs text-zinc-200 hover:bg-white/[0.05]">Insert into document</button>}
    </>}
  </aside>;
}
