import { NOTES_STORAGE_KEY } from "../config";
import type { AnnaRpcError, AnnaRuntime } from "../anna/types";
import { traced } from "../ui/activity-log";
import { type NotesDoc, parseDoc, withNoteAdded, withNoteRemoved } from "./model";

const MAX_ATTEMPTS = 3;

/**
 * Notes persistence. The ONLY storage used is the Anna storage Host API:
 * every read is anna.storage.get, every write is anna.storage.set. There is
 * no localStorage / IndexedDB / in-memory source of truth — the UI always
 * renders the document returned by storage.
 */
export class NotesRepository {
  /** Serialises mutations from this window so they never interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly anna: AnnaRuntime) {}

  /** Read the current notes document (empty on first run). */
  async load(): Promise<NotesDoc> {
    return (await this.read()).doc;
  }

  add(content: string): Promise<NotesDoc> {
    return this.mutate("add", (doc) => withNoteAdded(doc, content));
  }

  remove(id: string): Promise<NotesDoc> {
    return this.mutate("delete", (doc) => withNoteRemoved(doc, id));
  }

  private async read(): Promise<{ doc: NotesDoc; etag?: string }> {
    const anna = this.anna;
    try {
      const res = await traced("anna.storage.get", `key=${NOTES_STORAGE_KEY}`, () =>
        anna.storage.get<NotesDoc>({ key: NOTES_STORAGE_KEY }),
      );
      return { doc: parseDoc(res?.value), etag: res?.etag ?? undefined };
    } catch (err) {
      if ((err as AnnaRpcError).code === "not_found") return { doc: parseDoc(null) };
      throw err;
    }
  }

  private async write(doc: NotesDoc, etag: string | undefined, reason: string): Promise<void> {
    const anna = this.anna;
    await traced("anna.storage.set", `key=${NOTES_STORAGE_KEY} (${reason}, ${doc.items.length} notes)`, () =>
      anna.storage.set<NotesDoc>({
        key: NOTES_STORAGE_KEY,
        value: doc,
        // Optimistic concurrency: another window/tab may have written since
        // our read. Only sent when the backend handed us an etag.
        ...(etag ? { if_match: etag } : {}),
      }),
    );
  }

  /** read → apply → write, retried on a concurrent-write precondition failure. */
  private mutate(reason: string, apply: (doc: NotesDoc) => NotesDoc): Promise<NotesDoc> {
    const run = async (): Promise<NotesDoc> => {
      for (let attempt = 1; ; attempt++) {
        const { doc, etag } = await this.read();
        const next = apply(doc);
        try {
          await this.write(next, etag, reason);
        } catch (err) {
          if ((err as AnnaRpcError).code === "precondition_failed" && attempt < MAX_ATTEMPTS) continue;
          throw err;
        }
        // Re-read so the UI renders exactly what storage now holds.
        return this.load();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
