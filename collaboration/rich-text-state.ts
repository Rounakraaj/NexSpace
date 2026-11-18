import { IncomingMessage, MessageType } from "@hocuspocus/server";
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
} from "y-protocols/sync";
import * as Y from "yjs";

export class DocumentLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(documentId: string): Promise<() => void> {
    const previous = this.tails.get(documentId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.tails.set(documentId, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(documentId) === tail) {
        void tail.then(() => {
          if (this.tails.get(documentId) === tail) this.tails.delete(documentId);
        });
      }
    };
  }

  async runExclusive<T>(documentId: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(documentId);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function getYjsUpdateFromHocuspocusMessage(messageBytes: Uint8Array): Uint8Array | null {
  const message = new IncomingMessage(messageBytes);
  message.readVarString();
  const messageType = message.readVarUint();
  if (messageType !== MessageType.Sync && messageType !== MessageType.SyncReply) return null;

  const syncType = message.readVarUint();
  if (syncType === messageYjsSyncStep1) return null;
  if (syncType !== messageYjsSyncStep2 && syncType !== messageYjsUpdate) {
    throw new Error("Unsupported Hocuspocus Yjs sync message.");
  }
  return message.readVarUint8Array();
}

export function mergeYjsUpdates(updates: Uint8Array[]): Uint8Array {
  const document = new Y.Doc();
  try {
    for (const update of updates) Y.applyUpdate(document, update);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

export function applyRichTextReplacement(document: Y.Doc, replacementUpdate: Uint8Array) {
  document.transact(() => {
    const fragment = document.getXmlFragment("default");
    fragment.delete(0, fragment.length);
    Y.applyUpdate(document, replacementUpdate);
  });
}
