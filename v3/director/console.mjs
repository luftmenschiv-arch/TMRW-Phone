import { DirectorEventInspector } from './event-inspector.mjs';
import { UndoCanonService } from './undo-canon.mjs';

export class DirectorConsole {
  #inspector; #undo; #view = null;
  constructor({ database, eventEngine }) { this.#inspector = new DirectorEventInspector({ database }); this.#undo = new UndoCanonService({ database, eventEngine }); }
  async inspect(input) { this.#view = Object.freeze({ mode: 'inspection', data: await this.#inspector.inspect(input) }); return this.#view; }
  async previewUndo(input) { this.#view = Object.freeze({ mode: 'impact-preview', data: await this.#undo.preview(input) }); return this.#view; }
  async confirmUndo(input) { if (this.#view?.mode !== 'impact-preview' || this.#view.data.previewId !== input.preview?.previewId) throw new Error('Director Undo requires the currently displayed impact preview'); const result = await this.#undo.undo(input); this.#view = Object.freeze({ mode: 'undo-result', data: result }); return this.#view; }
  get view() { return this.#view ? structuredClone(this.#view) : null; }
  renderText() { if (!this.#view) return 'Director Mode — select a canonical Event'; if (this.#view.mode === 'impact-preview') return `Undo Canon impact: ${this.#view.data.impact.eventCount} Event(s), ${this.#view.data.impact.knowledgeGrantCount} Knowledge Grant(s), ${this.#view.data.impact.aiJobCount} AI job(s). Confirmation required.`; if (this.#view.mode === 'inspection') return `Event ${this.#view.data.event.id}\n${this.#view.data.event.eventType}\n${this.#view.data.event.storyId} / ${this.#view.data.event.branchId}\n${this.#view.data.provenance.classification}`; return `Undo Canon ${this.#view.data.event.status}`; }
}
