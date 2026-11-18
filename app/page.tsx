"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowUpRight, Bell, Check, ChevronDown,
  ChevronRight, CircleHelp, Command, FilePlus2, FileText, FolderKanban,
  LayoutGrid, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus,
  Search, Settings2, Sparkles, Star, Trash2, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Space = { id: string; name: string; tint: string };
type DocumentItem = {
  id: string;
  title: string;
  spaceId: string;
  excerpt: string;
  updatedAt: number;
  favorite: boolean;
  body: string;
};
type PreviewData = { spaces: Space[]; documents: DocumentItem[] };

const initialSpaces: Space[] = [
  { id: "studio", name: "Studio", tint: "violet" },
  { id: "product", name: "Product", tint: "blue" },
  { id: "research", name: "Research", tint: "teal" },
];

const initialDocuments: DocumentItem[] = [
  { id: "roadmap", title: "A calmer way to plan", spaceId: "product", excerpt: "Product direction · Q4 planning", updatedAt: Date.parse("2026-11-13T13:25:00+05:30"), favorite: true, body: "A thoughtful plan gives a team room to do its best work.\n\n## What we are building\n\nNexSpace brings plans, notes, and creative work into one shared place.\n\n## Next steps\n\n- Make the everyday workspace feel effortless\n- Give teams a clear view of what matters\n- Leave room for good ideas to grow" },
  { id: "design", title: "The details make the system", spaceId: "studio", excerpt: "Design · 8 min read", updatedAt: Date.parse("2026-11-13T12:51:00+05:30"), favorite: true, body: "A design system is a shared language.\n\n## Foundations\n\nKeep the primitives quiet, consistent, and easy to extend.\n\n## Principles\n\n- Clear before clever\n- Motion should help people understand change\n- Every screen deserves breathing room" },
  { id: "field-notes", title: "Field notes from the week", spaceId: "research", excerpt: "Research · Team notes", updatedAt: Date.parse("2026-11-13T10:29:00+05:30"), favorite: false, body: "## What we heard\n\nPeople want fewer places to check and more confidence that work is up to date.\n\n## Questions to explore\n\n- How do teams make decisions visible?\n- Where does collaboration slow down?" },
  { id: "launch", title: "A small launch, done well", spaceId: "product", excerpt: "Launch planning · 5 min read", updatedAt: Date.parse("2026-11-12T15:29:00+05:30"), favorite: false, body: "A focused launch makes the product easier to understand.\n\n## Checklist\n\n- Tell the story simply\n- Make the first run useful\n- Listen closely to early teams" },
];

const STORAGE_KEY = "nexspace-preview-v1";
const tintClasses: Record<string, string> = {
  violet: "bg-violet-400", blue: "bg-sky-400", teal: "bg-teal-400", amber: "bg-amber-400",
};

function relativeTime(timestamp: number, now: number) {
  if (!now) return "Recently";
  const minutes = Math.max(1, Math.floor((now - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Modal({ title, eyebrow, children, onClose, wide = false }: {
  title: string; eyebrow?: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.section role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ duration: 0.18 }} className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} overflow-hidden rounded-2xl border border-white/10 bg-[#111116] shadow-2xl shadow-black/50`}>
        <div className="flex items-start justify-between border-b border-white/[0.07] px-5 py-4">
          <div>{eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-violet-300">{eyebrow}</p>}<h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-100">{title}</h2></div>
          <button aria-label="Close dialog" onClick={onClose} className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"><X size={16} /></button>
        </div>
        {children}
      </motion.section>
    </motion.div>
  );
}

export default function Home() {
  const [data, setData] = useState<PreviewData>({ spaces: initialSpaces, documents: initialDocuments });
  const [ready, setReady] = useState(false);
  const [clock, setClock] = useState(0);
  const [activeSpace, setActiveSpace] = useState("all");
  const [section, setSection] = useState("Overview");
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newSpaceName, setNewSpaceName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as PreviewData;
          if (Array.isArray(parsed.spaces) && Array.isArray(parsed.documents)) setData(parsed);
        }
      } catch { /* Ignore invalid local preview data and use the sample set. */ }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setClock(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, ready]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); setCreateOpen(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);
  const activeDocument = data.documents.find((document) => document.id === editorId) ?? null;
  const activeSpaceName = data.spaces.find((space) => space.id === activeSpace)?.name;
  const visibleDocuments = useMemo(() => data.documents.filter((document) => {
    const matchesSpace = activeSpace === "all" || document.spaceId === activeSpace;
    const matchesSection = section !== "Favorites" || document.favorite;
    const matchesQuery = `${document.title} ${document.excerpt} ${data.spaces.find((space) => space.id === document.spaceId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesSpace && matchesSection && matchesQuery;
  }).sort((a, b) => b.updatedAt - a.updatedAt), [activeSpace, data, query, section]);

  function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const document: DocumentItem = { id: crypto.randomUUID(), title, spaceId: activeSpace === "all" ? (data.spaces[0]?.id ?? "studio") : activeSpace, excerpt: "Just created · Start writing", updatedAt: Date.now(), favorite: false, body: "" };
    setData((current) => ({ ...current, documents: [document, ...current.documents] }));
    setNewTitle(""); setCreateOpen(false); setEditorId(document.id); setSection("Overview");
  }

  function createSpace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newSpaceName.trim();
    if (!name) return;
    const space = { id: crypto.randomUUID(), name, tint: "amber" };
    setData((current) => ({ ...current, spaces: [...current.spaces, space] }));
    setActiveSpace(space.id); setNewSpaceName(""); setSpaceOpen(false); flash("Space created in this browser");
  }

  function updateDocument(id: string, update: Partial<DocumentItem>) {
    setData((current) => ({ ...current, documents: current.documents.map((document) => document.id === id ? { ...document, ...update, updatedAt: Date.now() } : document) }));
  }

  const openCreate = useCallback(() => { setPaletteOpen(false); setCreateOpen(true); }, []);
  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100 selection:bg-violet-500/30">
      <div className="flex min-h-screen">
        <AnimatePresence initial={false}>
          {sidebarOpen && <motion.aside key="sidebar" initial={{ width: 0, opacity: 0 }} animate={{ width: 252, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="relative z-20 hidden shrink-0 overflow-hidden border-r border-white/[0.065] bg-[#0c0c0f] md:flex md:flex-col">
            <div className="flex h-[68px] shrink-0 items-center gap-3 px-5">
              <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-violet-400 to-indigo-600 text-white shadow-lg shadow-violet-950/60"><Sparkles size={16} /></div>
              <div className="min-w-0"><p className="text-[15px] font-semibold tracking-[-0.04em]">NexSpace</p><p className="text-[9px] tracking-[0.18em] text-zinc-600">THINK TOGETHER</p></div>
              <button aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)} className="ml-auto rounded p-1 text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-300"><PanelLeftClose size={15} /></button>
            </div>
            <div className="px-3 pb-4">
              <button onClick={() => setSpaceOpen(true)} className="flex w-full items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left transition hover:border-white/[0.12] hover:bg-white/[0.045]">
                <div className="grid h-7 w-7 place-items-center rounded-md bg-indigo-400/10 text-indigo-300"><FolderKanban size={14} /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{activeSpaceName ?? "All spaces"}</p><p className="mt-0.5 text-[10px] text-zinc-600">Personal workspace</p></div><ChevronDown size={14} className="text-zinc-600" />
              </button>
            </div>
            <nav aria-label="Workspace navigation" className="px-3">
              <p className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Workspace</p>
              {[{ label: "Overview", icon: LayoutGrid }, { label: "Favorites", icon: Star }].map(({ label, icon: Icon }) => <button key={label} onClick={() => { setSection(label); setActiveSpace("all"); }} className={`mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[12px] transition ${section === label ? "bg-violet-400/[0.1] text-violet-200" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-200"}`}><Icon size={15} className={section === label ? "text-violet-300" : "text-zinc-600"} />{label}<span className="ml-auto text-[10px] text-zinc-700">{label === "Favorites" ? data.documents.filter((doc) => doc.favorite).length : ""}</span></button>)}
              <button onClick={() => flash("Invitations will be available when accounts are connected")} className="mb-0.5 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[12px] text-zinc-500 transition hover:bg-white/[0.035] hover:text-zinc-200"><Users size={15} className="text-zinc-600" />Shared with me<span className="ml-auto rounded border border-white/[0.07] px-1 py-0.5 text-[8px] text-zinc-600">SOON</span></button>
            </nav>
            <div className="mt-7 px-3">
              <div className="mb-2 flex items-center justify-between px-2"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Your spaces</p><button onClick={() => setSpaceOpen(true)} aria-label="Create a space" className="rounded p-1 text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-200"><Plus size={13} /></button></div>
              {data.spaces.map((space) => <button key={space.id} onClick={() => { setActiveSpace(space.id); setSection("Overview"); }} className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[11px] transition ${activeSpace === space.id ? "bg-white/[0.045] text-zinc-200" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300"}`}><span className={`h-1.5 w-1.5 rounded-full ${tintClasses[space.tint] ?? tintClasses.violet}`} />{space.name}<span className="ml-auto text-[9px] text-zinc-700">{data.documents.filter((doc) => doc.spaceId === space.id).length}</span></button>)}
            </div>
            <div className="mt-auto border-t border-white/[0.06] p-3">
              <button onClick={() => flash("Settings are part of the account setup milestone")} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-[11px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"><Settings2 size={14} />Settings</button>
              <div className="mt-1 flex items-center gap-2.5 rounded-md px-2 py-2"><div className="grid h-7 w-7 place-items-center rounded-full border border-violet-300/20 bg-violet-400/10 text-[10px] font-semibold text-violet-200">N</div><div><p className="text-[11px] font-medium text-zinc-300">NexSpace preview</p><p className="text-[9px] text-zinc-600">Local workspace</p></div><MoreHorizontal size={15} className="ml-auto text-zinc-600" /></div>
            </div>
          </motion.aside>}
        </AnimatePresence>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-white/[0.065] bg-[#09090b]/90 px-4 backdrop-blur-xl md:px-7">
            <div className="flex min-w-0 items-center gap-2.5">
              <button className="rounded-md p-1.5 text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-200 md:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={17} /></button>
              {!sidebarOpen && <button className="hidden rounded-md p-1.5 text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-200 md:block" aria-label="Expand sidebar" onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={16} /></button>}
              <div className="hidden items-center gap-2 text-[11px] text-zinc-600 sm:flex"><span>Workspace</span><ChevronRight size={12} /><span className="truncate text-zinc-300">{activeSpaceName ?? section}</span></div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/10 bg-amber-300/[0.045] px-2 py-1 text-[8px] font-medium tracking-[0.1em] text-amber-200/70"><span className="h-1 w-1 rounded-full bg-amber-300/70" />LOCAL PREVIEW</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPaletteOpen(true)} className="hidden h-8 items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 text-[10px] text-zinc-600 transition hover:border-white/[0.13] hover:text-zinc-300 sm:flex"><Search size={13} />Search or jump to...<kbd className="ml-3 flex items-center gap-0.5 rounded border border-white/[0.08] px-1 py-0.5 text-[9px]"><Command size={9} />K</kbd></button>
              <button onClick={() => setPaletteOpen(true)} aria-label="Search" className="rounded-md p-2 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200 sm:hidden"><Search size={15} /></button>
              <button aria-label="Notifications" onClick={() => flash("You’re all caught up")} className="rounded-md p-2 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200"><Bell size={15} /></button>
              <Link href="/login" className="flex h-8 items-center rounded-md border border-white/[0.1] px-2.5 text-[10px] font-medium text-zinc-300 transition hover:border-violet-300/30 hover:text-white">Sign in</Link>
              <button onClick={() => flash("Invitations will be available when accounts are connected")} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500 px-2.5 text-[10px] font-medium text-white shadow-sm shadow-violet-950/40 transition hover:bg-violet-400"><Plus size={13} />Invite</button>
            </div>
          </header>

          <div className="mx-auto max-w-[1080px] px-5 pb-12 pt-8 md:px-9 md:pt-10">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div><p className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.17em] text-violet-300"><Sparkles size={12} />A little room to think</p><h1 className="text-[28px] font-semibold tracking-[-0.045em] text-zinc-100 md:text-[34px]">Your work, in good company<span className="text-violet-400">.</span></h1><p className="mt-2 text-[12px] text-zinc-500">A quieter place for ideas to take shape.</p></div>
              <button onClick={openCreate} className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-md bg-zinc-100 px-3.5 text-[11px] font-semibold text-zinc-950 transition hover:bg-white sm:self-auto"><FilePlus2 size={14} />New document <kbd className="ml-1 hidden rounded border border-zinc-300 px-1 text-[9px] text-zinc-500 lg:inline">⌘ N</kbd></button>
            </motion.div>

            <motion.section initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06, duration: 0.34 }} className="relative mt-7 overflow-hidden rounded-xl border border-white/[0.075] bg-[#101014]">
              <div className="pointer-events-none absolute -right-14 -top-24 h-64 w-64 rounded-full bg-violet-500/[0.08] blur-[80px]" />
              <div className="relative flex flex-col justify-between gap-5 px-5 py-5 md:flex-row md:items-center md:px-6 md:py-6">
                <div className="max-w-lg"><div className="mb-2 flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.14em] text-violet-300"><span className="h-px w-4 bg-violet-400/70" />A workspace for what’s next</div><h2 className="text-[17px] font-medium tracking-tight text-zinc-100">Good work starts with a little space.</h2><p className="mt-1.5 max-w-md text-[11px] leading-5 text-zinc-500">Gather the threads, share what you’re thinking, and give your next idea somewhere to land.</p></div>
                <button onClick={openCreate} className="flex h-8 shrink-0 items-center gap-2 self-start rounded-md border border-white/[0.09] bg-white/[0.04] px-3 text-[10px] font-medium text-zinc-200 transition hover:border-white/[0.17] hover:bg-white/[0.075] md:self-auto">Start with a page <ArrowUpRight size={12} /></button>
              </div>
            </motion.section>

            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[{ label: "Pages in this space", value: data.documents.filter((doc) => activeSpace === "all" || doc.spaceId === activeSpace).length, icon: FileText, hint: "Ready when you are" }, { label: "Your spaces", value: data.spaces.length, icon: FolderKanban, hint: "Ideas, in their place" }, { label: "Starred", value: data.documents.filter((doc) => doc.favorite).length, icon: Star, hint: "The things to come back to" }].map((stat, index) => <motion.div key={stat.label} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + index * 0.05 }} className="rounded-lg border border-white/[0.065] bg-white/[0.018] px-4 py-3.5 transition hover:border-white/[0.11] hover:bg-white/[0.03]"><div className="flex items-center justify-between"><p className="text-[10px] text-zinc-500">{stat.label}</p><stat.icon size={14} className="text-zinc-600" /></div><div className="mt-2 flex items-baseline gap-2"><p className="text-xl font-semibold tracking-tight">{stat.value.toString().padStart(2, "0")}</p><span className="text-[9px] text-zinc-600">{stat.hint}</span></div></motion.div>)}
            </div>

            <section className="mt-9">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div><div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold tracking-tight">{section === "Favorites" ? "Saved for later" : "Recently opened"}</h2><span className="rounded border border-white/[0.07] px-1.5 py-0.5 text-[8px] text-zinc-600">{visibleDocuments.length}</span></div><p className="mt-1 text-[10px] text-zinc-600">A few things you’ve been working on.</p></div>
                <div className="flex items-center gap-2"><div className="relative"><Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" /><input id="workspace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a page" aria-label="Filter pages" className="h-7 w-36 rounded-md border border-white/[0.07] bg-white/[0.02] pl-7 pr-2 text-[10px] text-zinc-200 outline-none transition placeholder:text-zinc-700 focus:border-violet-400/30 sm:w-44" /></div><button onClick={openCreate} aria-label="Create document" className="grid h-7 w-7 place-items-center rounded-md border border-white/[0.07] text-zinc-500 transition hover:border-white/15 hover:text-white"><Plus size={13} /></button></div>
              </div>
              {visibleDocuments.length ? <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {visibleDocuments.map((document, index) => { const space = data.spaces.find((item) => item.id === document.spaceId); return <motion.article key={document.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + index * 0.035 }} className="group relative rounded-lg border border-white/[0.065] bg-[#0d0d11] p-3.5 transition hover:border-violet-300/20 hover:bg-[#101015]"><button onClick={() => setEditorId(document.id)} className="flex w-full items-start gap-3 text-left"><div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/[0.055] bg-white/[0.025] text-zinc-500 transition group-hover:text-violet-200"><FileText size={15} /></div><div className="min-w-0 flex-1 pr-6"><h3 className="truncate text-[11px] font-medium text-zinc-200">{document.title}</h3><p className="mt-1 truncate text-[9px] text-zinc-600">{document.excerpt}</p><div className="mt-3 flex items-center gap-1.5 text-[9px] text-zinc-600"><span className={`h-1 w-1 rounded-full ${tintClasses[space?.tint ?? "violet"]}`} />{space?.name ?? "Space"}<span className="text-zinc-800">·</span>{relativeTime(document.updatedAt, clock)}</div></div></button><button aria-label={document.favorite ? "Remove from favorites" : "Add to favorites"} title={document.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => updateDocument(document.id, { favorite: !document.favorite })} className={`absolute right-3 top-3 rounded p-1 transition ${document.favorite ? "text-amber-300" : "text-zinc-700 opacity-0 group-hover:opacity-100 hover:text-amber-200"}`}><Star size={12} fill={document.favorite ? "currentColor" : "none"} /></button></motion.article>; })}
              </div> : <div className="rounded-lg border border-dashed border-white/[0.09] px-4 py-10 text-center"><div className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-white/[0.07] text-zinc-600"><Search size={15} /></div><p className="mt-3 text-[11px] font-medium text-zinc-300">Nothing here just yet</p><p className="mt-1 text-[10px] text-zinc-600">Try another search, or make a page of your own.</p><button onClick={openCreate} className="mt-3 text-[10px] text-violet-300 hover:text-violet-200">Create a page <ArrowUpRight size={10} className="inline" /></button></div>}
            </section>

            <footer className="mt-10 flex items-center justify-between border-t border-white/[0.055] pt-4 text-[9px] text-zinc-700"><span>NexSpace <span className="px-1 text-zinc-800">·</span> Think together. Build better.</span><button onClick={() => flash("This preview stores your pages in this browser only")} className="flex items-center gap-1 text-zinc-600 hover:text-zinc-400"><CircleHelp size={11} /> About this preview</button></footer>
          </div>
        </section>
      </div>

      <AnimatePresence>{mobileNavOpen && <motion.div className="fixed inset-0 z-40 bg-black/65 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNavOpen(false)}><motion.nav aria-label="Mobile workspace navigation" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} onClick={(event) => event.stopPropagation()} className="flex h-full w-[270px] flex-col border-r border-white/10 bg-[#0c0c0f] p-4"><div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500"><Sparkles size={15} /></div><span className="font-semibold">NexSpace</span></div><button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={16} /></button></div>{["Overview", "Favorites"].map((label) => <button key={label} onClick={() => { setSection(label); setActiveSpace("all"); setMobileNavOpen(false); }} className="flex items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-xs text-zinc-400 hover:bg-white/5"><LayoutGrid size={15} />{label}</button>)}<p className="mb-2 mt-6 px-2 text-[9px] uppercase tracking-widest text-zinc-600">Spaces</p>{data.spaces.map((space) => <button key={space.id} onClick={() => { setActiveSpace(space.id); setSection("Overview"); setMobileNavOpen(false); }} className="flex items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs text-zinc-400 hover:bg-white/5"><span className={`h-1.5 w-1.5 rounded-full ${tintClasses[space.tint]}`} />{space.name}</button>)}<button onClick={() => { setMobileNavOpen(false); setSpaceOpen(true); }} className="mt-2 flex items-center gap-2 px-2.5 py-2 text-xs text-zinc-500"><Plus size={13} />New space</button></motion.nav></motion.div>}</AnimatePresence>

      <AnimatePresence>{createOpen && <Modal title="Start a new page" eyebrow="A fresh canvas" onClose={() => setCreateOpen(false)}><form onSubmit={createDocument} className="p-5"><label htmlFor="new-document-title" className="text-[10px] text-zinc-500">Page title</label><input id="new-document-title" autoFocus maxLength={120} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="A thought, a plan, a possibility…" className="mt-2 h-10 w-full rounded-md border border-white/[0.09] bg-white/[0.025] px-3 text-xs text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-violet-400/40" /><label htmlFor="new-document-space" className="mt-4 block text-[10px] text-zinc-500">Space</label><select id="new-document-space" value={activeSpace === "all" ? data.spaces[0]?.id : activeSpace} onChange={(event) => setActiveSpace(event.target.value)} className="mt-2 h-9 w-full rounded-md border border-white/[0.09] bg-[#17171c] px-3 text-xs text-zinc-300 outline-none">{data.spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select><p className="mt-3 text-[9px] leading-4 text-zinc-600">Pages are saved in this browser’s local storage. They are not shared with a team or account.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCreateOpen(false)} className="h-8 rounded-md px-3 text-[10px] text-zinc-500 hover:bg-white/[0.05] hover:text-white">Cancel</button><button type="submit" disabled={!newTitle.trim()} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-500 px-3 text-[10px] font-medium text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12} />Create page</button></div></form></Modal>}</AnimatePresence>

      <AnimatePresence>{spaceOpen && <Modal title="Your spaces" eyebrow="Choose a place to work" onClose={() => setSpaceOpen(false)}><div className="max-h-48 space-y-1 overflow-y-auto p-3">{[{ id: "all", name: "All spaces", tint: "violet" }, ...data.spaces].map((space) => <button key={space.id} onClick={() => { setActiveSpace(space.id); setSection("Overview"); setSpaceOpen(false); }} className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[11px] transition ${activeSpace === space.id ? "bg-violet-400/[0.1] text-violet-200" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${tintClasses[space.tint]}`} />{space.name}{activeSpace === space.id && <Check size={12} className="ml-auto" />}</button>)}</div><form onSubmit={createSpace} className="border-t border-white/[0.07] p-4"><label htmlFor="new-space-name" className="text-[10px] text-zinc-500">Create a new space</label><div className="mt-2 flex gap-2"><input id="new-space-name" maxLength={48} value={newSpaceName} onChange={(event) => setNewSpaceName(event.target.value)} placeholder="e.g. Brand studio" className="h-9 min-w-0 flex-1 rounded-md border border-white/[0.09] bg-white/[0.025] px-3 text-xs outline-none placeholder:text-zinc-700 focus:border-violet-400/40" /><button type="submit" disabled={!newSpaceName.trim()} aria-label="Create space" className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40"><Plus size={14} /></button></div><p className="mt-2 text-[9px] text-zinc-600">Spaces live in this browser preview.</p></form></Modal>}</AnimatePresence>

      <AnimatePresence>{paletteOpen && <Modal title="Where would you like to go?" eyebrow="Quick switcher" onClose={() => setPaletteOpen(false)}><div className="p-3"><div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.025] px-3"><Search size={14} className="text-zinc-600" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and spaces..." className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-600" /></div><div className="mt-3 space-y-1"><button onClick={openCreate} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/[0.05]"><Plus size={14} className="text-violet-300" />Create a new page<span className="ml-auto text-[9px] text-zinc-700">⌘ N</span></button>{data.documents.filter((document) => `${document.title} ${document.excerpt}`.toLowerCase().includes(query.toLowerCase())).slice(0, 5).map((document) => <button key={document.id} onClick={() => { setEditorId(document.id); setPaletteOpen(false); setQuery(""); }} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/[0.05]"><FileText size={14} className="text-zinc-600" />{document.title}<span className="ml-auto text-[9px] text-zinc-700">{data.spaces.find((space) => space.id === document.spaceId)?.name}</span></button>)}{data.spaces.filter((space) => space.name.toLowerCase().includes(query.toLowerCase())).map((space) => <button key={space.id} onClick={() => { setActiveSpace(space.id); setSection("Overview"); setPaletteOpen(false); setQuery(""); }} className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-300 hover:bg-white/[0.05]"><FolderKanban size={14} className="text-zinc-600" />Open {space.name}</button>)}</div><div className="mt-3 border-t border-white/[0.06] px-2 pt-2 text-[9px] text-zinc-700">↑↓ to browse <span className="px-1">·</span> Esc to close</div></div></Modal>}</AnimatePresence>

      <AnimatePresence>{activeDocument && <Modal title={activeDocument.title} eyebrow={`${data.spaces.find((space) => space.id === activeDocument.spaceId)?.name ?? "Workspace"} · saved in this browser`} onClose={() => setEditorId(null)} wide><div className="max-h-[72vh] overflow-y-auto px-6 py-5 md:px-10"><input aria-label="Document title" value={activeDocument.title} maxLength={120} onChange={(event) => updateDocument(activeDocument.id, { title: event.target.value })} className="w-full border-0 bg-transparent text-2xl font-semibold tracking-tight text-zinc-100 outline-none placeholder:text-zinc-700 md:text-3xl" placeholder="Untitled" /><div className="my-5 h-px bg-white/[0.06]" /><textarea aria-label="Document content" value={activeDocument.body} onChange={(event) => updateDocument(activeDocument.id, { body: event.target.value, excerpt: event.target.value.split("\n").find((line) => line.trim())?.slice(0, 70) || "A page in progress" })} placeholder="A blank page is full of possibility…\n\nStart writing here. Markdown-style notes work well in this preview." className="min-h-[38vh] w-full resize-y bg-transparent text-[13px] leading-7 text-zinc-300 outline-none placeholder:text-zinc-700" /><div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-[9px] text-zinc-600"><span className="flex items-center gap-1.5"><Check size={11} className="text-emerald-400" />Saved in this browser</span><div className="flex items-center gap-1"><button onClick={() => updateDocument(activeDocument.id, { favorite: !activeDocument.favorite })} className="flex items-center gap-1.5 rounded px-2 py-1.5 hover:bg-white/[0.05] hover:text-zinc-300"><Star size={11} fill={activeDocument.favorite ? "currentColor" : "none"} />{activeDocument.favorite ? "Starred" : "Star"}</button><button onClick={() => { setData((current) => ({ ...current, documents: current.documents.filter((item) => item.id !== activeDocument.id) })); setEditorId(null); flash("Page removed from this browser"); }} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-zinc-600 hover:bg-red-400/10 hover:text-red-300"><Trash2 size={11} />Delete</button></div></div></div></Modal>}</AnimatePresence>

      <AnimatePresence>{toast && <motion.div role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }} className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/10 bg-[#17171c] px-3.5 py-2.5 text-[10px] text-zinc-200 shadow-xl"><Check size={13} className="text-emerald-400" />{toast}</motion.div>}</AnimatePresence>
    </main>
  );
}
