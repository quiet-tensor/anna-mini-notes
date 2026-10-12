import "./styles.css";
import { connectAnna, describeError } from "./anna/runtime";
import type { AnnaRuntime } from "./anna/types";
import { NOTES_STORAGE_KEY } from "./config";
import { EmptyNoteError, type Note } from "./notes/model";
import { NotesRepository } from "./notes/repository";
import { summarizeNotes } from "./summary/summarizer";
import { onActivity } from "./ui/activity-log";
import { NotesView } from "./ui/view";

async function bootstrap(): Promise<void> {
  let anna: AnnaRuntime | null = null;
  let repo: NotesRepository | null = null;

  /** Run one user action with the UI locked and errors surfaced. */
  async function act(label: string, fn: () => Promise<void>): Promise<void> {
    if (!repo || !anna) return;
    view.setBusy(true);
    view.showStatus("");
    try {
      await fn();
    } catch (err) {
      console.error(`[mini-notes] ${label} failed`, err);
      view.showStatus(`${label} failed: ${describeError(err)}`, "error");
    } finally {
      view.setBusy(false);
    }
  }

  const view = new NotesView({
    onAdd: (content) =>
      act("Save", async () => {
        try {
          view.renderNotes((await repo!.add(content)).items);
          view.clearInput();
        } catch (err) {
          if (err instanceof EmptyNoteError) return view.showStatus("Empty notes are not saved.", "error");
          throw err;
        }
      }),
    onDelete: (note: Note) =>
      act("Delete", async () => {
        view.renderNotes((await repo!.remove(note.id)).items);
      }),
    onSummarize: () =>
      act("Summarize", async () => {
        // Read the notes fresh from storage so the tool sees exactly what is persisted.
        const doc = await repo!.load();
        view.renderNotes(doc.items);
        if (doc.items.length === 0) return view.showStatus("Add a note before summarizing.", "error");
        view.showSummaryPending();
        try {
          view.showSummary(await summarizeNotes(anna!, doc.items));
        } catch (err) {
          view.showSummaryError(describeError(err));
        }
      }),
  });
  onActivity((entries) => view.renderActivity(entries));

  view.setBusy(true);
  view.showStatus("Connecting to Anna host…");
  try {
    anna = await connectAnna();
    repo = new NotesRepository(anna);
    view.renderNotes((await repo.load()).items);
    view.showStatus("");
    view.setBusy(false);
    void anna.window.set_title({ title: "Mini Notes" }).catch(() => undefined);
    // Another window/tab of this app wrote the notes key: re-read from storage.
    anna.on("runtime_state_synced", (payload) => {
      const patch = (payload as { patch?: Record<string, unknown> } | null)?.patch;
      if (!patch || !(NOTES_STORAGE_KEY in patch) || !repo) return;
      repo.load().then((doc) => view.renderNotes(doc.items), () => undefined);
    });
  } catch (err) {
    view.showStatus(
      `Could not connect to the Anna host (${describeError(err)}). Open this app through \`anna-app dev\`, not as a plain web page.`,
      "error",
    );
  }
}

void bootstrap();
