"use client";

import { useEffect, useState } from "react";
import { Copy, LoaderCircle, MailPlus, Trash2, Users, X } from "lucide-react";

type Member = { id: string; userId: string; role: string; user: { name: string | null; email: string | null; image: string | null } };
type Invitation = { id: string; email: string; role: string; expiresAt: string | null };

export function WorkspacePeople({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEWER");
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/workspaces/${workspaceId}/members`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Could not load workspace members.");
    setMembers(result.members); setInvitations(result.invitations); setCanManage(result.canManage);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/workspaces/${workspaceId}/members`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Could not load workspace members.");
        if (!cancelled) { setMembers(result.members); setInvitations(result.invitations); setCanManage(result.canManage); setError(""); }
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load workspace members."); });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  async function call(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? "The request could not be completed.");
    return result;
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault(); if (!email.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = await call(`/api/workspaces/${workspaceId}/members`, "POST", { email, role }); setInvitations((current) => [result.invitation, ...current]); setInviteUrl(result.inviteUrl); setMessage("Invitation created. Copy the private link and send it to the invitee."); setEmail(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not invite this person."); }
    finally { setBusy(false); }
  }

  async function updateMember(member: Member, nextRole: string) {
    setError("");
    try { await call(`/api/workspaces/${workspaceId}/members/${member.id}`, "PATCH", { role: nextRole }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this member."); }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.user.name || member.user.email || "this member"} from the workspace?`)) return;
    setError("");
    try { await call(`/api/workspaces/${workspaceId}/members/${member.id}`, "DELETE"); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove this member."); }
  }

  async function revokeInvitation(invitation: Invitation) {
    setError("");
    try { await call(`/api/workspaces/${workspaceId}/invitations/${invitation.id}`, "DELETE"); setInvitations((current) => current.filter((item) => item.id !== invitation.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not revoke this invitation."); }
  }

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label="Workspace members" className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[#101014] shadow-2xl shadow-black/50">
      <header className="flex h-14 items-center justify-between border-b border-white/[0.07] px-5"><div className="flex items-center gap-2 text-sm font-medium"><Users size={15} className="text-violet-300" />People and invitations</div><button onClick={onClose} aria-label="Close members panel" className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-white"><X size={15} /></button></header>
      {error && <p role="alert" className="mx-5 mt-3 rounded-md border border-rose-300/10 bg-rose-300/[0.04] px-3 py-2 text-[10px] text-rose-200">{error}</p>}
      {message && <p role="status" className="mx-5 mt-3 rounded-md border border-emerald-300/10 bg-emerald-300/[0.04] px-3 py-2 text-[10px] text-emerald-200">{message}</p>}
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <section><h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Members <span className="ml-1 text-zinc-700">{members.length}</span></h2><div className="space-y-1.5">{members.map((member) => <div key={member.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-400/10 text-[10px] font-semibold text-violet-200">{(member.user.name || member.user.email || "?").slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-[11px] text-zinc-200">{member.user.name || "NexSpace member"}</p><p className="truncate text-[9px] text-zinc-600">{member.user.email}</p></div>{canManage && member.role !== "OWNER" ? <><select aria-label={`Role for ${member.user.name || member.user.email}`} value={member.role} onChange={(event) => void updateMember(member, event.target.value)} className="h-7 rounded border border-white/10 bg-[#15151a] px-1.5 text-[9px] text-zinc-400"><option value="EDITOR">Editor</option><option value="COMMENTER">Commenter</option><option value="VIEWER">Viewer</option></select><button onClick={() => void removeMember(member)} aria-label="Remove member" className="text-zinc-700 hover:text-rose-300"><Trash2 size={12} /></button></> : <span className="text-[9px] text-zinc-600">{member.role === "OWNER" ? "Owner" : member.role}</span>}</div>)}</div></section>
        {canManage && <section className="border-t border-white/[0.07] pt-5"><h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Invite someone</h2><form onSubmit={invite} className="space-y-2"><input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Teammate’s email" className="h-9 w-full rounded-md border border-white/[0.08] bg-white/[0.02] px-3 text-xs outline-none focus:border-violet-400/40" /><div className="flex gap-2"><select value={role} onChange={(event) => setRole(event.target.value)} className="h-9 flex-1 rounded-md border border-white/[0.08] bg-[#15151a] px-2 text-[10px] text-zinc-300"><option value="EDITOR">Editor</option><option value="COMMENTER">Commenter</option><option value="VIEWER">Viewer</option></select><button disabled={busy || !email.trim()} className="flex h-9 items-center gap-1.5 rounded-md bg-violet-500 px-3 text-[10px] font-medium text-white disabled:opacity-40">{busy ? <LoaderCircle size={12} className="animate-spin" /> : <MailPlus size={12} />}Create invitation</button></div></form>
          {inviteUrl && <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/20 p-2.5"><p className="break-all text-[9px] text-zinc-500">{inviteUrl}</p><button onClick={() => { void navigator.clipboard.writeText(inviteUrl).then(() => setMessage("Invitation link copied."), () => setError("Could not copy the invitation link. Copy it from the text above.")); }} className="mt-2 flex items-center gap-1 text-[9px] text-violet-300 hover:text-violet-200"><Copy size={11} />Copy invite link</button></div>}
        </section>}
        {canManage && invitations.length > 0 && <section className="border-t border-white/[0.07] pt-5"><h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Pending invitations</h2><div className="space-y-2">{invitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-2 rounded-md border border-white/[0.06] px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-[10px] text-zinc-300">{invitation.email}</p><p className="mt-0.5 text-[9px] text-zinc-600">{invitation.role} · expires {invitation.expiresAt ? new Date(invitation.expiresAt).toLocaleDateString() : "never"}</p></div><button onClick={() => void revokeInvitation(invitation)} aria-label="Revoke invitation" className="text-zinc-700 hover:text-rose-300"><X size={13} /></button></div>)}</div></section>}
      </div>
    </aside>
  </div>;
}
