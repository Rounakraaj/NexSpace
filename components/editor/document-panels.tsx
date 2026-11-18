"use client";

import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { Check, Clock3, LoaderCircle, MessageSquare, RotateCcw, Send, X } from "lucide-react";

type Anchor = { from: number; to: number; text: string };
type Author = { id: string; name: string | null; image?: string | null };
type Reply = { id: string; body: string; createdAt: string; author: Author };
type CommentItem = { id: string; body: string; resolved: boolean; createdAt: string; author: Author; replies: Reply[] };
type Thread = { id: string; anchor: Anchor | null; createdAt: string; author: Author; comments: CommentItem[] };
type Snapshot = { id: string; label: string | null; content: JSONContent; createdAt: string; author: Author };

export function DocumentPanels({ documentId, userId, open, initialAnchor, canComment, canEdit, onClose, onAnchorUsed, onRestore }: {
  documentId: string;
  userId: string;
  open: "comments" | "history" | null;
  initialAnchor: Anchor | null;
  canComment: boolean;
  canEdit: boolean;
  onClose: () => void;
  onAnchorUsed: () => void;
  onRestore: (content: JSONContent) => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [draft, setDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loadedPanel, setLoadedPanel] = useState<string | null>(null);
  const loading = Boolean(open && loadedPanel !== `${documentId}:${open}`);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const endpoint = open === "comments" ? `/api/documents/${documentId}/comments` : `/api/documents/${documentId}/snapshots`;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Could not load this panel.");
        if (!cancelled) {
          setError("");
          if (open === "comments") setThreads(result.threads);
          else setSnapshots(result.snapshots);
        }
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load this panel."); })
      .finally(() => { if (!cancelled) setLoadedPanel(`${documentId}:${open}`); });
    return () => { cancelled = true; };
  }, [documentId, open]);

  async function call(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "The request could not be completed.");
    return result;
  }

  async function refreshComments() {
    const result = await call(`/api/documents/${documentId}/comments`, "GET");
    setThreads(result.threads);
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !canComment) return;
    setError("");
    try {
      await call(`/api/documents/${documentId}/comments`, "POST", { body: draft.trim(), ...(initialAnchor ? { anchor: initialAnchor } : {}) });
      setDraft(""); onAnchorUsed(); await refreshComments();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add the comment."); }
  }

  async function addReply(commentId: string) {
    const body = replyDrafts[commentId]?.trim();
    if (!body || !canComment) return;
    setError("");
    try { await call(`/api/comments/${commentId}/replies`, "POST", { body }); setReplyDrafts((current) => ({ ...current, [commentId]: "" })); await refreshComments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add the reply."); }
  }

  async function setResolved(comment: CommentItem, resolved: boolean) {
    setError("");
    try { await call(`/api/comments/${comment.id}`, "PATCH", { resolved }); await refreshComments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the thread."); }
  }

  async function createSnapshot() {
    setError("");
    try { await call(`/api/documents/${documentId}/snapshots`, "POST", { label: `Manual snapshot · ${new Date().toLocaleString()}` }); const result = await call(`/api/documents/${documentId}/snapshots`, "GET"); setSnapshots(result.snapshots); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a snapshot."); }
  }

  async function restore(snapshot: Snapshot) {
    if (!canEdit || !window.confirm(`Restore “${snapshot.label || "this version"}”?`)) return;
    setError("");
    try {
      await call(`/api/documents/${documentId}/snapshots/${snapshot.id}/restore`, "POST");
      onRestore(snapshot.content);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not restore this version."); }
  }

  if (!open) return null;
  return <div className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label={open === "comments" ? "Document comments" : "Version history"} className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#101014] shadow-2xl shadow-black/50">
      <header className="flex h-14 items-center justify-between border-b border-white/[0.07] px-4"><div className="flex items-center gap-2 text-xs font-medium">{open === "comments" ? <MessageSquare size={14} className="text-violet-300" /> : <Clock3 size={14} className="text-violet-300" />}{open === "comments" ? "Comments" : "Version history"}</div><button onClick={onClose} aria-label="Close panel" className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-white"><X size={15} /></button></header>
      {error && <p role="alert" className="mx-4 mt-3 rounded-md border border-rose-300/10 bg-rose-300/[0.04] px-3 py-2 text-[10px] text-rose-200">{error}</p>}
      {loading ? <div className="grid flex-1 place-items-center text-zinc-600"><LoaderCircle size={16} className="animate-spin" /></div> : open === "comments" ? <>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {threads.length === 0 && <div className="py-8 text-center text-[11px] text-zinc-600">No discussion yet. Select text to start a thread.</div>}
          {threads.map((thread) => <section key={thread.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
            {thread.anchor?.text && <p className="mb-3 border-l-2 border-violet-400/50 pl-2 text-[10px] italic text-zinc-500">“{thread.anchor.text.slice(0, 180)}”</p>}
            {thread.comments.map((comment) => <div key={comment.id} className="mb-2 last:mb-0"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-medium text-zinc-300">{comment.author.name || "Teammate"}<span className="ml-2 font-normal text-zinc-700">{new Date(comment.createdAt).toLocaleString()}</span></p>{(canEdit || comment.author.id === userId) && <button onClick={() => void setResolved(comment, !comment.resolved)} className="text-[9px] text-zinc-600 hover:text-violet-200">{comment.resolved ? "Reopen" : "Resolve"}</button>}</div><p className={`mt-1 whitespace-pre-wrap text-[11px] leading-5 ${comment.resolved ? "text-zinc-600 line-through" : "text-zinc-300"}`}>{comment.body}</p>
              {comment.replies.map((reply) => <div key={reply.id} className="ml-3 mt-2 border-l border-white/10 pl-2"><p className="text-[9px] text-zinc-500">{reply.author.name || "Teammate"}</p><p className="mt-0.5 whitespace-pre-wrap text-[10px] leading-4 text-zinc-400">{reply.body}</p></div>)}
              {canComment && <form onSubmit={(event) => { event.preventDefault(); void addReply(comment.id); }} className="mt-2 flex gap-1.5"><input value={replyDrafts[comment.id] ?? ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [comment.id]: event.target.value }))} maxLength={5000} placeholder="Reply…" className="h-7 min-w-0 flex-1 rounded border border-white/[0.08] bg-black/20 px-2 text-[10px] outline-none focus:border-violet-400/30" /><button aria-label="Send reply" disabled={!replyDrafts[comment.id]?.trim()} className="grid h-7 w-7 place-items-center rounded bg-white/[0.06] text-zinc-400 disabled:opacity-30"><Send size={11} /></button></form>}
            </div>)}
          </section>)}
        </div>
        {canComment && <form onSubmit={addComment} className="border-t border-white/[0.07] p-4"><label htmlFor="new-comment" className="mb-2 block text-[10px] text-zinc-500">{initialAnchor?.text ? `Comment on “${initialAnchor.text.slice(0, 60)}${initialAnchor.text.length > 60 ? "…" : ""}”` : "Add a comment"}</label><textarea id="new-comment" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={5000} rows={3} placeholder="Share a thought with your team…" className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/20 p-2.5 text-[11px] leading-5 outline-none focus:border-violet-400/30" /><button disabled={!draft.trim()} className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-violet-500 text-[10px] font-medium text-white disabled:opacity-40"><Send size={12} />Add comment</button></form>}
      </> : <>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">{snapshots.length === 0 && <div className="py-8 text-center text-[11px] text-zinc-600">No saved versions yet.</div>}{snapshots.map((snapshot) => <section key={snapshot.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-medium text-zinc-300">{snapshot.label || "Version"}</p><p className="mt-1 text-[9px] text-zinc-600">{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.author.name || "Teammate"}</p></div>{canEdit && <button onClick={() => void restore(snapshot)} className="flex h-7 shrink-0 items-center gap-1 rounded border border-white/10 px-2 text-[9px] text-zinc-400 hover:bg-white/[0.05] hover:text-white"><RotateCcw size={11} />Restore</button>}</div><details className="mt-2"><summary className="cursor-pointer text-[9px] text-violet-300/80">Preview content</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-[9px] leading-4 text-zinc-500">{JSON.stringify(snapshot.content, null, 2).slice(0, 4000)}</pre></details></section>)}</div>
        {canEdit && <div className="border-t border-white/[0.07] p-4"><button onClick={() => void createSnapshot()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-white/10 text-[10px] text-zinc-300 hover:bg-white/[0.05]"><Check size={12} />Create snapshot</button></div>}
      </>}
    </aside>
  </div>;
}
