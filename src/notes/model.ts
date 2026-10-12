import { MAX_NOTE_LENGTH } from "../config";

export interface Note {
  id: string;
  /** 1-based insertion order; never reused after a delete. */
  seq: number;
  content: string;
  createdAt: string;
}

/** The single document persisted under NOTES_STORAGE_KEY. */
export interface NotesDoc {
  version: 1;
  nextSeq: number;
  items: Note[];
}

export const emptyDoc = (): NotesDoc => ({ version: 1, nextSeq: 1, items: [] });

/** Defensive parse of whatever storage returned (null on first run). */
export function parseDoc(raw: unknown): NotesDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const obj = raw as Partial<NotesDoc>;
  const items = Array.isArray(obj.items)
    ? obj.items.filter(
        (n): n is Note =>
          !!n && typeof n.id === "string" && typeof n.seq === "number" && typeof n.content === "string",
      )
    : [];
  const maxSeq = items.reduce((m, n) => Math.max(m, n.seq), 0);
  const nextSeq = typeof obj.nextSeq === "number" && obj.nextSeq > maxSeq ? obj.nextSeq : maxSeq + 1;
  return { version: 1, nextSeq, items: [...items].sort((a, b) => a.seq - b.seq) };
}

export class EmptyNoteError extends Error {
  constructor() {
    super("Note is empty");
  }
}

/** Trim + validate user input; throws EmptyNoteError for blank input. */
export function normaliseContent(input: string): string {
  const content = input.trim();
  if (!content) throw new EmptyNoteError();
  return content.slice(0, MAX_NOTE_LENGTH);
}

export function withNoteAdded(doc: NotesDoc, content: string, now = new Date()): NotesDoc {
  const note: Note = {
    id: `n${doc.nextSeq}-${now.getTime().toString(36)}`,
    seq: doc.nextSeq,
    content: normaliseContent(content),
    createdAt: now.toISOString(),
  };
  return { version: 1, nextSeq: doc.nextSeq + 1, items: [...doc.items, note] };
}

export function withNoteRemoved(doc: NotesDoc, id: string): NotesDoc {
  return { ...doc, items: doc.items.filter((n) => n.id !== id) };
}
