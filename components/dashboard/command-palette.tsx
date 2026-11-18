"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Search, Shapes, Users } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";

type Workspace = { id: string; name: string };
type SearchResult = { workspaces: Workspace[]; documents: Array<{ id: string; title: string; type: string; workspaceId: string; workspace: { name: string } }> };

export function CommandPalette({ open, onOpenChange, workspaces, onSwitchWorkspace, onCreateDocument, onOpenPeople }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  onSwitchWorkspace: (id: string) => void;
  onCreateDocument: (type: "PAGE" | "CANVAS") => Promise<void>;
  onOpenPeople: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult>({ workspaces: [], documents: [] });
  const [resultQuery, setResultQuery] = useState("");
  const [searchingQuery, setSearchingQuery] = useState("");
  const router = useRouter();
  const normalizedQuery = query.trim();
  const visibleResults = resultQuery === normalizedQuery ? results : { workspaces: [], documents: [] };
  const searching = searchingQuery === normalizedQuery && normalizedQuery.length >= 2;

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const normalized = query.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchingQuery(normalized);
      fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const value = await response.json();
          if (!response.ok) throw new Error(value.message ?? "Search failed.");
          setResultQuery(normalized);
          setResults(value as SearchResult);
        })
        .catch(() => { if (!controller.signal.aborted) { setResultQuery(normalized); setResults({ workspaces: [], documents: [] }); } })
        .finally(() => { if (!controller.signal.aborted) setSearchingQuery((current) => current === normalized ? "" : current); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  function close() { onOpenChange(false); setQuery(""); }

  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Search NexSpace" description="Find workspaces and documents or run a command." className="max-w-xl border border-white/10 bg-[#111116] text-zinc-100">
    <Command shouldFilter={false} className="bg-transparent text-zinc-100">
      <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder="Search workspaces and pages…" className="text-xs" />
      <CommandList className="max-h-[min(60vh,440px)] p-2">
        {normalizedQuery.length >= 2 && !searching && !visibleResults.documents.length && !visibleResults.workspaces.length && resultQuery === normalizedQuery && <CommandEmpty className="py-5 text-xs text-zinc-500">No matching workspaces or pages.</CommandEmpty>}
        {searching && <p role="status" className="px-3 py-2 text-[10px] text-zinc-500">Searching…</p>}
        {query.trim().length < 2 && <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => { close(); void onCreateDocument("PAGE"); }}><FilePlus2 size={14} />Create a page<CommandShortcut>↵</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => { close(); void onCreateDocument("CANVAS"); }}><Shapes size={14} />Create a canvas</CommandItem>
          <CommandItem onSelect={() => { close(); onOpenPeople(); }}><Users size={14} />People and invitations</CommandItem>
        </CommandGroup>}
        {query.trim().length < 2 && workspaces.length > 0 && <><CommandSeparator /><CommandGroup heading="Switch workspace">{workspaces.slice(0, 6).map((workspace) => <CommandItem key={workspace.id} onSelect={() => { onSwitchWorkspace(workspace.id); close(); }}>{workspace.name}</CommandItem>)}</CommandGroup></>}
        {visibleResults.documents.length > 0 && <><CommandSeparator /><CommandGroup heading="Pages and canvases">{visibleResults.documents.map((document) => <CommandItem key={document.id} value={document.id} onSelect={() => { close(); router.push(`/dashboard/documents/${document.id}`); }}><span className="grid h-6 w-6 place-items-center rounded bg-white/[0.05]">{document.type === "CANVAS" ? <Shapes size={13} /> : <FilePlus2 size={13} />}</span><span className="min-w-0 flex-1 truncate">{document.title}</span><span className="truncate text-[10px] text-zinc-600">{document.workspace.name}</span></CommandItem>)}</CommandGroup></>}
        {visibleResults.workspaces.length > 0 && <><CommandSeparator /><CommandGroup heading="Workspaces">{visibleResults.workspaces.map((workspace) => <CommandItem key={workspace.id} value={workspace.id} onSelect={() => { onSwitchWorkspace(workspace.id); close(); }}>{workspace.name}<CommandShortcut>Switch</CommandShortcut></CommandItem>)}</CommandGroup></>}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-white/[0.07] px-3 py-2 text-[9px] text-zinc-600"><Search size={11} />Search is limited to workspaces you can access. <span className="ml-auto">Esc to close</span></div>
    </Command>
  </CommandDialog>;
}
