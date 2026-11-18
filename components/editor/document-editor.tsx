"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { ArrowLeft, Bold, Check, Clock3, Code2, Heading1, Heading2, ImagePlus, Italic, Link2, List, ListChecks, ListOrdered, LoaderCircle, MessageSquare, Quote, Redo2, Save, Sparkles, Strikethrough, Table2, Underline, Undo2 } from "lucide-react";
import { DocumentPanels } from "@/components/editor/document-panels";
import { AiCopilot } from "@/components/editor/ai-copilot";
const CanvasEditor = dynamic(() => import("@/components/editor/canvas-editor").then((module) => module.CanvasEditor), {
  ssr: false,
  loading: () => <main className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-500"><LoaderCircle className="animate-spin" size={18} /></main>,
});

type DocumentData = { id: string; title: string; content: JSONContent | null; workspaceId: string; type: "PAGE" | "CANVAS"; updatedAt: string };

export function DocumentEditor({ documentId, canEdit, canComment, userId, collaborationUrl, canvasUrl, userName, licenseKey, aiAvailable }: { documentId: string; canEdit: boolean; canComment: boolean; userId: string; collaborationUrl: string; canvasUrl: string; userName: string; licenseKey?: string; aiAvailable: boolean }) {
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [collabStatus, setCollabStatus] = useState<"connecting" | "live" | "reconnecting" | "offline">(collaborationUrl ? "connecting" : "offline");
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Could not open this page.");
        if (!cancelled) setDocument(result.document);
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not open this page."); });
    return () => { cancelled = true; };
  }, [documentId]);

  useEffect(() => {
    if (!document || document.type !== "PAGE" || !collaborationUrl) return;
    let cancelled = false;
    const websocket = new HocuspocusProviderWebsocket({ url: collaborationUrl, autoConnect: false });
    const client = new HocuspocusProvider({
      name: document.id,
      websocketProvider: websocket,
      token: async () => {
        const response = await fetch(`/api/documents/${document.id}/collaboration-ticket`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not authorize live collaboration.");
        return (await response.json()).token as string;
      },
      onStatus: ({ status }) => {
        if (cancelled) return;
        if (status === "connected") setCollabStatus("reconnecting");
        if (status === "disconnected") setCollabStatus("offline");
      },
      onSynced: ({ state }) => {
        if (!state || cancelled) return;
        client.setAwarenessField("user", { name: userName, color: userColor(userName) });
        setCollabStatus("live");
      },
      onAuthenticationFailed: ({ reason }) => {
        if (cancelled) return;
        setCollabStatus("offline");
        setRecoveryWarning(`Collaboration could not reconnect: ${reason}. Your local edits remain on this device.`);
      },
    });

    let persistence: IndexeddbPersistence | null = null;
    let localRecoveryAvailable = true;
    const activateProvider = () => {
      if (cancelled) return;
      if (localRecoveryAvailable) setRecoveryWarning("");
      setProvider(client);
      client.attach();
      void websocket.connect();
    };
    const reportRecoveryFailure = (cause: unknown) => {
      if (cancelled) return;
      localRecoveryAvailable = false;
      console.error("Local Yjs recovery storage is unavailable.", cause);
      setRecoveryWarning("Offline recovery storage is unavailable. Keep this tab open until collaboration reconnects.");
      activateProvider();
    };
    try {
      persistence = new IndexeddbPersistence(`nexspace:${userId}:${document.id}`, client.document);
      void persistence.whenSynced.then(activateProvider).catch(reportRecoveryFailure);
    } catch (cause) {
      reportRecoveryFailure(cause);
    }

    return () => {
      cancelled = true;
      client.destroy();
      websocket.destroy();
      if (persistence) {
        void persistence.destroy().finally(() => client.document.destroy()).catch((cause: unknown) => {
          console.error("Could not close local Yjs recovery storage.", cause);
        });
      } else {
        client.document.destroy();
      }
    };
  }, [document, collaborationUrl, userId, userName]);

  if (error) return <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-center text-zinc-100"><div><p role="alert" className="text-sm text-rose-300">{error}</p><Link href="/dashboard" className="mt-4 inline-block text-xs text-violet-300">Back to dashboard</Link></div></main>;
  if (!document) return <main className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-500"><LoaderCircle className="animate-spin" size={18} /></main>;
  if (document.type === "CANVAS") return <CanvasEditor documentId={document.id} canEdit={canEdit} canvasUrl={canvasUrl} userId={userId} userName={userName} licenseKey={licenseKey} />;
  if (collaborationUrl && !provider) return <main className="grid min-h-screen place-items-center bg-[#09090b] text-center text-zinc-500"><div><LoaderCircle className="mx-auto animate-spin" size={18} /><p className="mt-3 text-xs">Restoring local collaboration state…</p></div></main>;
  return <EditorSurface key={document.id} document={document} canEdit={canEdit} canComment={canComment} userId={userId} provider={provider} collabStatus={collabStatus} recoveryWarning={recoveryWarning} userName={userName} aiAvailable={aiAvailable} />;
}

function EditorSurface({ document, canEdit, canComment, userId, provider, collabStatus, recoveryWarning, userName, aiAvailable }: { document: DocumentData; canEdit: boolean; canComment: boolean; userId: string; provider: HocuspocusProvider | null; collabStatus: "connecting" | "live" | "reconnecting" | "offline"; recoveryWarning: string; userName: string; aiAvailable: boolean }) {
  const [title, setTitle] = useState(document.title);
  const [savedTitle, setSavedTitle] = useState(document.title);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveRevision, setSaveRevision] = useState(0);
  const [titleError, setTitleError] = useState("");
  const [collaborators, setCollaborators] = useState<Array<{ name: string; color: string }>>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState<"comments" | "history" | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [commentAnchor, setCommentAnchor] = useState<{ from: number; to: number; text: string } | null>(null);
  const pendingRevision = useRef(0);
  const baseUpdatedAt = useRef(document.updatedAt);
  const saving = useRef(false);
  const slashPosition = useRef<number | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, ...(provider ? { undoRedo: false } : {}) }),
      Placeholder.configure({ placeholder: "Start with a thought. Type / for blocks…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: false, allowBase64: false }),
      TableKit.configure({ table: { resizable: true } }),
      ...(provider ? [Collaboration.configure({ document: provider.document }), CollaborationCaret.configure({ provider, user: { name: userName, color: userColor(userName) } })] : []),
    ],
    content: provider ? undefined : (document.content ?? { type: "doc", content: [{ type: "paragraph" }] }),
    onUpdate: () => {
      if (!canEdit) return;
      if (provider) return;
      pendingRevision.current += 1;
      setStatus("dirty");
      setSaveRevision((value) => value + 1);
    },
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === "/" && canEdit && view.state.selection.empty) {
          slashPosition.current = view.state.selection.from;
          setSlashOpen(true);
        } else if (event.key === "Escape" && slashOpen) {
          setSlashOpen(false);
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!provider?.awareness) return;
    const update = () => {
      const users = Array.from(provider.awareness?.getStates().values() ?? [])
        .map((state) => state.user as { name?: string; color?: string } | undefined)
        .filter((user): user is { name: string; color: string } => Boolean(user?.name))
        .map((user) => ({ name: user.name, color: user.color ?? "#8b5cf6" }));
      setCollaborators(users);
    };
    update();
    provider.on("awarenessUpdate", update);
    return () => { provider.off("awarenessUpdate", update); };
  }, [provider]);

  const saveContent = useCallback(async () => {
    if (!editor || saving.current || pendingRevision.current === 0) return;
    saving.current = true;
    setStatus("saving");
    try {
      while (pendingRevision.current > 0) {
        pendingRevision.current = 0;
        const response = await fetch(`/api/documents/${document.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editor.getJSON(), baseUpdatedAt: baseUpdatedAt.current }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Could not save this page.");
        if (typeof result.document?.updatedAt === "string") baseUpdatedAt.current = result.document.updatedAt;
        if (pendingRevision.current === 0) setStatus("saved");
      }
    } catch (cause) {
      pendingRevision.current = Math.max(1, pendingRevision.current);
      setStatus("error");
      setTitleError(cause instanceof Error ? cause.message : "Could not save this page.");
    } finally {
      saving.current = false;
    }
  }, [document.id, editor]);

  useEffect(() => {
    if (saveRevision === 0 || !canEdit || provider) return;
    const timer = window.setTimeout(() => { void saveContent(); }, 850);
    return () => window.clearTimeout(timer);
  }, [saveRevision, canEdit, provider, saveContent]);

  async function saveTitle() {
    if (!canEdit || !title.trim() || title.trim() === savedTitle) return;
    setTitleError("");
    try {
      const response = await fetch(`/api/documents/${document.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Could not rename this page.");
      setSavedTitle(result.document.title);
      setTitle(result.document.title);
    } catch (cause) { setTitleError(cause instanceof Error ? cause.message : "Could not rename this page."); }
  }

  function addLink() {
    if (!editor) return;
    const value = window.prompt("Paste a link (https://…)");
    if (!value) return;
    try {
      const url = new URL(value);
      if (!(["https:", "http:"].includes(url.protocol))) throw new Error();
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.toString() }).run();
    } catch { setTitleError("Enter a valid http or https link."); }
  }

  function addImage() {
    if (!editor) return;
    const value = window.prompt("Paste an image URL (https://…)");
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") throw new Error();
      editor.chain().focus().setImage({ src: url.toString(), alt: "" }).run();
    } catch { setTitleError("Enter a valid https image URL."); }
  }

  function openComments() {
    const selection = editor?.state.selection;
    if (selection && !selection.empty) {
      setCommentAnchor({
        from: selection.from,
        to: selection.to,
        text: editor!.state.doc.textBetween(selection.from, selection.to, " ").slice(0, 500),
      });
    } else setCommentAnchor(null);
    setPanelOpen("comments");
  }

  function runSlashCommand(action: "paragraph" | "heading" | "subheading" | "bullets" | "tasks" | "quote" | "code" | "table") {
    if (!editor) return;
    const start = slashPosition.current;
    if (start !== null) editor.chain().focus().setTextSelection({ from: start, to: start + 1 }).deleteRange({ from: start, to: start + 1 }).run();
    slashPosition.current = null;
    setSlashOpen(false);
    const chain = editor.chain().focus();
    if (action === "paragraph") chain.setParagraph().run();
    if (action === "heading") chain.toggleHeading({ level: 1 }).run();
    if (action === "subheading") chain.toggleHeading({ level: 2 }).run();
    if (action === "bullets") chain.toggleBulletList().run();
    if (action === "tasks") chain.toggleTaskList().run();
    if (action === "quote") chain.toggleBlockquote().run();
    if (action === "code") chain.toggleCodeBlock().run();
    if (action === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  if (!editor) return <main className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-500"><LoaderCircle className="animate-spin" size={18} /></main>;

  const button = (label: string, icon: React.ReactNode, action: () => void, active = false) => <button type="button" title={label} aria-label={label} onClick={action} className={`grid h-8 w-8 place-items-center rounded transition ${active ? "bg-violet-400/15 text-violet-200" : "text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-100"}`}>{icon}</button>;
  const format = (command: () => void) => () => { if (canEdit) command(); };

  return <main className="min-h-screen bg-[#09090b] text-zinc-100">
    <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#09090b]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-3 sm:px-7"><Link href="/dashboard" aria-label="Back to dashboard" className="grid h-8 w-8 shrink-0 place-items-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-white"><ArrowLeft size={15} /></Link><div className="min-w-0 flex-1"><input aria-label="Document title" value={title} disabled={!canEdit} maxLength={120} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="w-full bg-transparent text-xs font-medium text-zinc-200 outline-none disabled:opacity-100" /></div>{provider && collaborators.slice(0, 3).map((person, index) => <span key={`${person.name}-${index}`} title={person.name} className="grid h-7 w-7 place-items-center rounded-full border border-[#09090b] text-[9px] font-semibold text-white" style={{ backgroundColor: person.color }}>{person.name.slice(0, 1).toUpperCase()}</span>)}<div className="flex items-center gap-1"><button onClick={() => setAiOpen(true)} aria-label="Open AI Copilot" title="AI Copilot" className={`grid h-8 w-8 place-items-center rounded ${aiOpen ? "bg-violet-400/10 text-violet-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-violet-200"}`}><Sparkles size={14} /></button>{canComment && <button onClick={openComments} aria-label="Open comments" title="Comment on selection" className={`grid h-8 w-8 place-items-center rounded ${panelOpen === "comments" ? "bg-violet-400/10 text-violet-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"}`}><MessageSquare size={14} /></button>}<button onClick={() => setPanelOpen("history")} aria-label="Open version history" title="Version history" className={`grid h-8 w-8 place-items-center rounded ${panelOpen === "history" ? "bg-violet-400/10 text-violet-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"}`}><Clock3 size={14} /></button></div><div aria-live="polite" className="hidden items-center gap-1.5 text-[10px] text-zinc-500 md:flex">{status === "saving" ? <LoaderCircle size={12} className="animate-spin" /> : status === "saved" ? <Check size={12} className="text-emerald-400" /> : status === "error" ? <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />}{status === "saving" ? "Saving" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : "Unsaved"}</div><span className={`hidden rounded-full px-2 py-1 text-[9px] sm:inline ${collabStatus === "live" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.05] text-zinc-500"}`}>{collabStatus === "live" ? "Live" : collabStatus === "connecting" ? "Connecting" : collabStatus === "reconnecting" ? "Reconnecting" : "Local save"}</span>{status !== "saved" && canEdit && !provider && <button onClick={() => void saveContent()} className="hidden h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-[10px] text-zinc-300 hover:bg-white/[0.05] sm:flex"><Save size={12} />Save</button>}</div>
    </header>
    {canEdit && <div className="sticky top-14 z-10 border-b border-white/[0.055] bg-[#0c0c10]/95 backdrop-blur-xl"><div className="mx-auto flex max-w-5xl flex-wrap items-center gap-0.5 px-4 py-2 sm:px-7">
      {button("Bold", <Bold size={14} />, format(() => editor.chain().focus().toggleBold().run()), editor.isActive("bold"))}
      {button("Italic", <Italic size={14} />, format(() => editor.chain().focus().toggleItalic().run()), editor.isActive("italic"))}
      {button("Underline", <Underline size={14} />, format(() => editor.chain().focus().toggleUnderline().run()), editor.isActive("underline"))}
      {button("Strikethrough", <Strikethrough size={14} />, format(() => editor.chain().focus().toggleStrike().run()), editor.isActive("strike"))}
      <span className="mx-1 h-5 w-px bg-white/10" />
      {button("Heading 1", <Heading1 size={15} />, format(() => editor.chain().focus().toggleHeading({ level: 1 }).run()), editor.isActive("heading", { level: 1 }))}
      {button("Heading 2", <Heading2 size={15} />, format(() => editor.chain().focus().toggleHeading({ level: 2 }).run()), editor.isActive("heading", { level: 2 }))}
      {button("Bullet list", <List size={15} />, format(() => editor.chain().focus().toggleBulletList().run()), editor.isActive("bulletList"))}
      {button("Numbered list", <ListOrdered size={15} />, format(() => editor.chain().focus().toggleOrderedList().run()), editor.isActive("orderedList"))}
      {button("Task list", <ListChecks size={15} />, format(() => editor.chain().focus().toggleTaskList().run()), editor.isActive("taskList"))}
      {button("Blockquote", <Quote size={14} />, format(() => editor.chain().focus().toggleBlockquote().run()), editor.isActive("blockquote"))}
      {button("Code block", <Code2 size={14} />, format(() => editor.chain().focus().toggleCodeBlock().run()), editor.isActive("codeBlock"))}
      <span className="mx-1 h-5 w-px bg-white/10" />
      {button("Insert link", <Link2 size={14} />, addLink, editor.isActive("link"))}
      {button("Insert image", <ImagePlus size={14} />, addImage)}
      {button("Insert table", <Table2 size={14} />, format(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()))}
      <span className="mx-1 h-5 w-px bg-white/10" />
      {button("Undo", <Undo2 size={14} />, format(() => editor.chain().focus().undo().run()))}
      {button("Redo", <Redo2 size={14} />, format(() => editor.chain().focus().redo().run()))}
    </div></div>}
    <article className="relative mx-auto max-w-3xl px-5 pb-32 pt-12 sm:px-8 sm:pt-16"><div className="mb-8"><p className="mb-3 text-[10px] font-medium uppercase tracking-[0.16em] text-violet-300">{canEdit ? "A shared page" : "Read only"}</p><input aria-label="Document title" value={title} disabled={!canEdit} maxLength={120} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} className="w-full bg-transparent text-4xl font-semibold tracking-[-0.045em] text-zinc-100 outline-none placeholder:text-zinc-700 sm:text-5xl" placeholder="Untitled" /></div>
      {canEdit && <BubbleMenu editor={editor} className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#19191f] p-1 shadow-xl shadow-black/40">{button("Bold", <Bold size={13} />, format(() => editor.chain().focus().toggleBold().run()), editor.isActive("bold"))}{button("Italic", <Italic size={13} />, format(() => editor.chain().focus().toggleItalic().run()), editor.isActive("italic"))}{button("Link", <Link2 size={13} />, addLink, editor.isActive("link"))}</BubbleMenu>}
      {slashOpen && canEdit && <div role="menu" aria-label="Insert a block" className="absolute left-5 top-32 z-30 w-56 rounded-xl border border-white/10 bg-[#15151a] p-2 shadow-2xl shadow-black/50 sm:left-8">{([["paragraph", "Text"], ["heading", "Heading 1"], ["subheading", "Heading 2"], ["bullets", "Bullet list"], ["tasks", "Task list"], ["quote", "Quote"], ["code", "Code block"], ["table", "Table"]] as const).map(([action, label]) => <button key={action} role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => runSlashCommand(action)} className="block w-full rounded-md px-2.5 py-2 text-left text-[11px] text-zinc-300 hover:bg-violet-400/10 hover:text-violet-100">{label}</button>)}</div>}
      <EditorContent editor={editor} className="nexspace-editor" />{(titleError || recoveryWarning) && <p role="alert" className="mt-5 text-xs text-rose-300">{titleError || recoveryWarning}</p>}<div className="mt-10 border-t border-white/[0.06] pt-4 text-[10px] text-zinc-600">{provider ? collabStatus === "live" ? "Live changes are synchronized." : "Edits are queued on this device and will synchronize when reconnected." : "Autosaves to your workspace. Live collaboration is unavailable."}</div></article>
    <DocumentPanels documentId={document.id} userId={userId} open={panelOpen} initialAnchor={commentAnchor} canComment={canComment} canEdit={canEdit} onClose={() => setPanelOpen(null)} onAnchorUsed={() => setCommentAnchor(null)} onRestore={(content) => { if (!provider) editor.commands.setContent(content); setTitleError(""); }} />
    {aiOpen && <AiCopilot documentId={document.id} selectedText={editor.state.selection.empty ? "" : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ").slice(0, 8_000)} available={aiAvailable} onClose={() => setAiOpen(false)} onInsert={(content) => { editor.chain().focus().insertContent({ type: "text", text: content }).run(); }} />}
  </main>;
}

function userColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 68% 55%)`;
}
