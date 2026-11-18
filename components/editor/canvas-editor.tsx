"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tldraw, createUserId, type TLAssetStore } from "tldraw";
import { computed } from "@tldraw/state";
import { useSync } from "@tldraw/sync";
import "tldraw/tldraw.css";

type CanvasProps = {
  documentId: string;
  canEdit: boolean;
  canvasUrl: string;
  userId: string;
  userName: string;
  licenseKey?: string;
};

export function CanvasEditor(props: CanvasProps) {
  const [attempt, setAttempt] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);

  useEffect(() => {
    const updateOnline = () => {
      const connected = navigator.onLine;
      setOnline(connected);
      // A fresh session also requests a fresh short-lived collaboration ticket.
      if (connected) setAttempt((current) => current + 1);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  return <CanvasSession
    key={`${props.documentId}:${attempt}`}
    {...props}
    online={online}
    onRetry={() => setAttempt((current) => current + 1)}
  />;
}

function CanvasSession({ documentId, canEdit, canvasUrl, userId, userName, licenseKey, online, onRetry }: CanvasProps & {
  online: boolean;
  onRetry: () => void;
}) {
  const uri = useCallback(async () => {
    if (!canvasUrl) throw new Error("Canvas sync is not configured. Set NEXT_PUBLIC_CANVAS_URL and start the canvas service.");

    const response = await fetch(`/api/documents/${documentId}/collaboration-ticket`, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as { token?: string; message?: string };
    if (!response.ok) throw new Error(result.message ?? "Could not authorize canvas collaboration. Sign in again and retry.");
    if (!result.token) throw new Error("The collaboration service did not issue an access ticket.");

    let endpoint: URL;
    try {
      endpoint = new URL(`/connect/${documentId}`, canvasUrl.endsWith("/") ? canvasUrl : `${canvasUrl}/`);
    } catch {
      throw new Error("Canvas sync URL must be a valid ws:// or wss:// address.");
    }
    if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
    if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
    if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
      throw new Error("Canvas sync URL must use ws:// or wss://.");
    }
    // tldraw appends its sessionId/storeId parameters to this per-attempt URI.
    endpoint.searchParams.set("token", result.token);
    return endpoint.toString();
  }, [documentId, canvasUrl]);

  const users = useMemo(() => ({
    currentUser: computed("nexspace-canvas-user", () => ({
      id: createUserId(userId),
      typeName: "user" as const,
      name: userName,
      color: userColor(userId),
      imageUrl: "",
      meta: {},
    })),
  }), [userId, userName]);

  const assets = useMemo<TLAssetStore>(() => ({
    upload: async (_asset, file) => {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch(`/api/documents/${documentId}/attachments`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { url?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Image upload failed.");
      if (!result.url) throw new Error("Image upload completed without a usable URL.");
      return { src: result.url };
    },
    resolve: (asset) => asset.props.src,
  }), [documentId]);

  const store = useSync({ uri, users, assets });
  if (store.status === "loading") {
    return <CanvasMessage
      title={online ? "Connecting to canvas" : "You are offline"}
      detail={online
        ? "Opening the shared canvas. The connection will retry if the service is interrupted."
        : "Canvas will reconnect when your internet connection returns."}
      onRetry={onRetry}
    />;
  }
  if (store.status === "error") {
    return <CanvasMessage
      title={online ? "Canvas is unavailable" : "You are offline"}
      detail={store.error.message}
      onRetry={onRetry}
    />;
  }

  return <div className="fixed inset-0 z-30 bg-[#f9fafb]" aria-label="Collaborative canvas">
    {!online && <div role="status" className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-md bg-amber-100 px-4 py-2 text-xs text-amber-950 shadow-lg">Connection interrupted. Canvas will reconnect when you are online; recent edits may not be saved yet.</div>}
    <Tldraw
      store={store.store}
      licenseKey={licenseKey}
      onMount={(editor) => { if (!canEdit) editor.updateInstanceState({ isReadonly: true }); }}
    />
    <a href="/dashboard" className="fixed bottom-4 left-4 z-[60] rounded-md border border-black/10 bg-white/90 px-3 py-2 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur hover:bg-white">Back to workspace</a>
  </div>;
}

function CanvasMessage({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#09090b] px-5 text-center text-zinc-100"><div>
    <p className="text-sm font-medium">{title}</p>
    <p role="status" className="mt-2 max-w-sm text-xs text-zinc-500">{detail}</p>
    <button type="button" onClick={onRetry} className="mt-5 rounded-md bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400">Retry connection</button>
    <a href="/dashboard" className="ml-4 mt-5 inline-block text-xs text-violet-300">Back to workspace</a>
  </div></main>;
}

function userColor(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 68% 48%)`;
}
