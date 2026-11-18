"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FilePlus2, FolderKanban, LogOut, Plus, Search, Shapes, Sparkles, Star, Trash2, Users } from "lucide-react";
import { WorkspacePeople } from "@/components/dashboard/workspace-people";
import { CommandPalette } from "@/components/dashboard/command-palette";

type Workspace = { id: string; name: string; description: string | null; role: string };
type Doc = { id: string; workspaceId: string; title: string; type: string; favorite: boolean; updatedAt: string };

export function Dashboard({ initialWorkspaces, user }: { initialWorkspaces: Workspace[]; user: { name: string | null; email: string | null } }) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaces[0]?.id ?? "");
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [newDocumentType, setNewDocumentType] = useState<"PAGE" | "CANVAS">("PAGE");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const router = useRouter();
  const activeWorkspace = workspaces.find((item) => item.id === workspaceId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadDocuments = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const response = await fetch(`/api/documents?workspaceId=${encodeURIComponent(workspaceId)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Could not load pages.");
      setDocuments(result.documents);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load pages."); }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetch(`/api/documents?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Could not load pages.");
        if (!cancelled) { setDocuments(result.documents); setError(""); }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load pages.");
      });
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function request(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "The change could not be saved.");
    return result;
  }

  async function createDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !workspaceId) return;
    setBusy(true); setError("");
    try { await request("/api/documents", "POST", { workspaceId, title: title.trim(), type: newDocumentType }); setTitle(""); await loadDocuments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the document."); }
    finally { setBusy(false); }
  }

  async function createFromPalette(type: "PAGE" | "CANVAS") {
    if (!workspaceId) { setError("Create or join a workspace first."); return; }
    setBusy(true); setError("");
    try {
      const result = await request("/api/documents", "POST", { workspaceId, title: type === "CANVAS" ? "Untitled canvas" : "Untitled page", type });
      await loadDocuments();
      router.push(`/dashboard/documents/${result.document.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the document."); }
    finally { setBusy(false); }
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceName.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await request("/api/workspaces", "POST", { name: workspaceName.trim() });
      setWorkspaces((current) => [result.workspace, ...current]); setWorkspaceId(result.workspace.id); setWorkspaceName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the workspace."); }
    finally { setBusy(false); }
  }

  async function renameWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (!activeWorkspace || !workspaceName.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await request(`/api/workspaces/${activeWorkspace.id}`, "PATCH", { name: workspaceName.trim() });
      setWorkspaces((current) => current.map((item) => item.id === activeWorkspace.id ? { ...item, name: result.workspace.name } : item)); setWorkspaceName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rename the workspace."); }
    finally { setBusy(false); }
  }

  async function deleteWorkspace() {
    if (!activeWorkspace || activeWorkspace.role !== "OWNER") return;
    if (!window.confirm(`Delete “${activeWorkspace.name}” and all its pages?`)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/workspaces/${activeWorkspace.id}`, "DELETE");
      const remaining = workspaces.filter((item) => item.id !== activeWorkspace.id);
      setWorkspaces(remaining);
      setWorkspaceId(remaining[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete the workspace."); }
    finally { setBusy(false); }
  }

  async function updateDocument(document: Doc, update: object) {
    try { await request(`/api/documents/${document.id}`, "PATCH", update); await loadDocuments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the page."); }
  }

  async function deleteDocument(document: Doc) {
    if (!window.confirm(`Delete “${document.title}”?`)) return;
    try { await request(`/api/documents/${document.id}`, "DELETE"); await loadDocuments(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete the page."); }
  }

  const visible = useMemo(() => documents.filter((document) => document.title.toLowerCase().includes(query.toLowerCase())), [documents, query]);

  return <main className="min-h-screen bg-[#09090b] text-zinc-100">
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <aside className="hidden w-64 shrink-0 border-r border-white/[0.07] p-5 md:flex md:flex-col">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-400 to-indigo-600"><Sparkles size={15} /></span>NexSpace</Link>
        <label className="mt-8 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Workspace</label>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 h-9 rounded-md border border-white/10 bg-[#111116] px-2 text-xs outline-none focus:border-violet-400/50">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select>
        <nav className="mt-7 space-y-1 text-xs"><a href="/dashboard" className="flex items-center gap-2 rounded-md bg-violet-400/10 px-3 py-2 text-violet-200"><FolderKanban size={14} />All pages</a></nav>
        <form onSubmit={createWorkspace} className="mt-7 border-t border-white/[0.07] pt-5"><label className="text-[10px] text-zinc-600">Create a workspace</label><div className="mt-2 flex gap-1"><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" maxLength={80} className="h-8 min-w-0 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 text-[10px] outline-none" /><button disabled={busy} aria-label="Create workspace" className="grid h-8 w-8 place-items-center rounded bg-violet-500 text-white"><Plus size={13} /></button></div></form>
        <div className="mt-auto border-t border-white/[0.07] pt-4"><p className="truncate text-xs text-zinc-300">{user.name || user.email}</p><p className="mt-1 truncate text-[10px] text-zinc-600">{user.email}</p><button onClick={() => signOut({ callbackUrl: "/" })} className="mt-3 flex items-center gap-2 text-[10px] text-zinc-500 hover:text-zinc-200"><LogOut size={12} />Sign out</button></div>
      </aside>
      <section className="min-w-0 flex-1 px-5 py-7 sm:px-9 md:py-10">
        <header className="flex items-center justify-between border-b border-white/[0.07] pb-4 md:hidden"><Link href="/" className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-violet-300" />NexSpace</Link><button onClick={() => signOut({ callbackUrl: "/" })} aria-label="Sign out"><LogOut size={16} /></button></header>
        <div className="flex flex-wrap items-end justify-between gap-4 pt-5 md:pt-0"><div><p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.17em] text-violet-300"><Sparkles size={12} />Your workspace</p><h1 className="text-3xl font-semibold tracking-tight">{activeWorkspace?.name ?? "Workspace"}</h1><p className="mt-2 text-xs text-zinc-500">Pages and ideas, together in one place.</p></div><span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-zinc-500">{activeWorkspace?.role ?? "Member"}</span></div>
        {error && <div role="alert" className="mt-6 rounded-lg border border-rose-300/15 bg-rose-300/[0.04] px-3 py-2 text-xs text-rose-200">{error}</div>}
        <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_260px]">
          <div><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium">Pages and canvases <span className="ml-1 text-zinc-600">{visible.length}</span></h2><div className="flex items-center gap-2"><button onClick={() => setCommandOpen(true)} className="h-8 rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 text-[10px] text-zinc-500 hover:text-zinc-200"><span className="hidden sm:inline">Search and commands</span><span className="sm:hidden">Search</span><kbd className="ml-2 rounded border border-white/10 px-1 py-0.5 text-[9px]">⌘K</kbd></button><div className="flex h-8 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5"><Search size={12} className="text-zinc-600" /><input aria-label="Search documents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter current workspace" className="w-32 bg-transparent text-[10px] outline-none placeholder:text-zinc-700" /></div></div></div>
            {visible.length ? <div className="space-y-2">{visible.map((document) => <article key={document.id} className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-[#101014] px-3.5 py-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/[0.04] text-zinc-500">{document.type === "CANVAS" ? <Shapes size={14} /> : <FilePlus2 size={14} />}</div><div className="min-w-0 flex-1"><input aria-label={`${document.type === "CANVAS" ? "Canvas" : "Page"} title`} defaultValue={document.title} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== document.title) void updateDocument(document, { title: event.target.value.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="w-full bg-transparent text-xs text-zinc-200 outline-none" /><p className="mt-1 text-[9px] text-zinc-600">{document.type === "CANVAS" ? "Canvas" : "Page"} · {new Date(document.updatedAt).toLocaleDateString()}</p></div><Link href={`/dashboard/documents/${document.id}`} aria-label={`Open ${document.title}`} title={document.type === "CANVAS" ? "Open canvas" : "Open page"} className="text-zinc-600 hover:text-violet-200"><ExternalLink size={13} /></Link><button onClick={() => void updateDocument(document, { favorite: !document.favorite })} aria-label={document.favorite ? "Remove favorite" : "Add favorite"} className={document.favorite ? "text-amber-300" : "text-zinc-700 hover:text-amber-200"}><Star size={13} fill={document.favorite ? "currentColor" : "none"} /></button><button onClick={() => void deleteDocument(document)} aria-label="Delete document" className="text-zinc-700 hover:text-rose-300"><Trash2 size={13} /></button></article>)}</div> : <div className="rounded-lg border border-dashed border-white/10 px-4 py-12 text-center text-xs text-zinc-600">No documents yet. Create a page or canvas to get started.</div>}
            <form onSubmit={createDocument} className="mt-3 flex flex-wrap gap-2"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Give a new ${newDocumentType === "CANVAS" ? "canvas" : "page"} a title`} maxLength={120} className="h-9 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 text-xs outline-none focus:border-violet-400/40" /><select aria-label="New document type" value={newDocumentType} onChange={(event) => setNewDocumentType(event.target.value as "PAGE" | "CANVAS")} className="h-9 rounded-md border border-white/[0.08] bg-[#111116] px-2 text-[10px] text-zinc-300"><option value="PAGE">Page</option><option value="CANVAS">Canvas</option></select><button disabled={busy || !title.trim()} className="flex h-9 items-center gap-1.5 rounded-md bg-violet-500 px-3 text-[10px] font-medium text-white disabled:opacity-40"><Plus size={13} />Create</button></form>
          </div>
          <aside className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4"><p className="text-xs font-medium">Workspace settings</p><p className="mt-1 text-[10px] leading-5 text-zinc-600">You have {activeWorkspace?.role.toLowerCase()} access in this workspace.</p>{activeWorkspace && <button onClick={() => setPeopleOpen(true)} className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded border border-white/10 text-[10px] text-zinc-300 hover:bg-white/[0.05]"><Users size={12} />People and invitations</button>}{activeWorkspace?.role === "OWNER" && <><form onSubmit={renameWorkspace} className="mt-4 border-t border-white/[0.06] pt-4"><label className="text-[10px] text-zinc-500">Rename workspace</label><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={80} placeholder={activeWorkspace.name} className="mt-2 h-8 w-full rounded border border-white/10 bg-white/[0.03] px-2 text-[10px] outline-none" /><button disabled={busy || !workspaceName.trim()} className="mt-2 h-8 w-full rounded bg-white/[0.07] text-[10px] text-zinc-300 disabled:opacity-40">Save name</button></form><button onClick={() => void deleteWorkspace()} disabled={busy} className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded border border-rose-300/10 text-[10px] text-rose-300/70 hover:bg-rose-300/[0.05] disabled:opacity-40"><Trash2 size={12} />Delete workspace</button></> }<div className="mt-4 border-t border-white/[0.06] pt-4 md:hidden"><p className="text-[10px] text-zinc-500">Switch workspace</p><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="mt-2 h-8 w-full rounded border border-white/10 bg-[#111116] px-2 text-[10px]">{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><p className="mt-3 text-[10px] text-zinc-500">Create a workspace</p><form onSubmit={createWorkspace} className="mt-2 flex gap-1"><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Workspace name" maxLength={80} className="h-8 min-w-0 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 text-[10px]" /><button className="grid h-8 w-8 place-items-center rounded bg-violet-500"><Plus size={13} /></button></form></div></aside>
        </div>
      </section>
    </div>
    {activeWorkspace && <WorkspacePeople workspaceId={activeWorkspace.id} open={peopleOpen} onClose={() => setPeopleOpen(false)} />}
    <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} workspaces={workspaces} onSwitchWorkspace={setWorkspaceId} onCreateDocument={createFromPalette} onOpenPeople={() => setPeopleOpen(true)} />
  </main>;
}
