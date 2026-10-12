import type { Note } from "../notes/model";
import type { SummaryResult } from "../summary/summarizer";
import type { ActivityEntry } from "./activity-log";
import { byId, h } from "./dom";

const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

export interface ViewHandlers {
  onAdd(content: string): void;
  onDelete(note: Note): void;
  onSummarize(): void;
}

/** All DOM reads/writes live here; main.ts only talks to this class. */
export class NotesView {
  private readonly form = byId<HTMLFormElement>("note-form");
  private readonly input = byId<HTMLTextAreaElement>("note-input");
  private readonly addBtn = byId<HTMLButtonElement>("add-btn");
  private readonly list = byId<HTMLOListElement>("note-list");
  private readonly empty = byId<HTMLParagraphElement>("empty-state");
  private readonly count = byId<HTMLSpanElement>("note-count");
  private readonly status = byId<HTMLParagraphElement>("status");
  private readonly summarizeBtn = byId<HTMLButtonElement>("summarize-btn");
  private readonly summaryBox = byId<HTMLDivElement>("summary");
  private readonly activity = byId<HTMLOListElement>("activity");
  private busy = false;
  private noteCount = 0;

  constructor(private readonly handlers: ViewHandlers) {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (this.input.value.trim()) handlers.onAdd(this.input.value);
    });
    this.input.addEventListener("input", () => this.syncButtons());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this.form.requestSubmit();
    });
    this.summarizeBtn.addEventListener("click", () => handlers.onSummarize());
    this.syncButtons();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.syncButtons();
    for (const b of this.list.querySelectorAll<HTMLButtonElement>("button")) b.disabled = busy;
  }

  clearInput(): void {
    this.input.value = "";
    this.syncButtons();
    this.input.focus();
  }

  renderNotes(notes: readonly Note[]): void {
    this.noteCount = notes.length;
    this.count.textContent = String(notes.length);
    this.empty.hidden = notes.length > 0;
    this.list.replaceChildren(
      ...notes.map((note) => {
        const del = h("button", { type: "button", class: "delete", "aria-label": `Delete note #${note.seq}` }, "Delete");
        del.disabled = this.busy;
        del.addEventListener("click", () => this.handlers.onDelete(note));
        return h(
          "li",
          { class: "note", "data-id": note.id },
          h("span", { class: "seq", title: "Order added" }, `#${note.seq}`),
          h(
            "div",
            { class: "body" },
            h("p", { class: "content" }, note.content),
            h("time", { datetime: note.createdAt }, timeFmt.format(new Date(note.createdAt))),
          ),
          del,
        );
      }),
    );
    this.syncButtons();
  }

  showStatus(message: string, kind: "info" | "error" = "info"): void {
    this.status.textContent = message;
    this.status.dataset.kind = kind;
    this.status.hidden = !message;
  }

  showSummaryPending(): void {
    this.summaryBox.hidden = false;
    this.summaryBox.dataset.state = "pending";
    this.summaryBox.replaceChildren(
      h("p", { class: "muted" }, "Asking the Executa tool… (anna.tools.invoke → sampling/createMessage)"),
    );
  }

  showSummary(result: SummaryResult): void {
    this.summaryBox.hidden = false;
    this.summaryBox.dataset.state = "ok";
    const meta = [
      `${result.noteCount} notes`,
      result.model ? `model: ${result.model}` : null,
      result.invokeId ? `invoke_id: ${result.invokeId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    this.summaryBox.replaceChildren(
      h("h3", {}, "Summary"),
      h("p", { class: "summary-text" }, result.summary),
      h("p", { class: "muted small" }, meta),
    );
  }

  showSummaryError(message: string): void {
    this.summaryBox.hidden = false;
    this.summaryBox.dataset.state = "error";
    this.summaryBox.replaceChildren(h("h3", {}, "Summarize failed"), h("pre", { class: "error-text" }, message));
  }

  renderActivity(entries: readonly ActivityEntry[]): void {
    this.activity.replaceChildren(
      ...entries.map((e) =>
        h(
          "li",
          { class: e.ok ? "ok" : "fail" },
          h("code", {}, e.call),
          ` ${e.detail} `,
          h("span", { class: "muted" }, `${e.ms}ms · ${e.at.toLocaleTimeString()}`),
        ),
      ),
    );
  }

  private syncButtons(): void {
    this.addBtn.disabled = this.busy || this.input.value.trim().length === 0;
    this.summarizeBtn.disabled = this.busy || this.noteCount === 0;
  }
}
