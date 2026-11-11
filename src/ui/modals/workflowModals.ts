import { FuzzySuggestModal, Modal, Setting, SuggestModal, type App, type FuzzyMatch } from "obsidian";
import type EntitiesPlugin from "../../main";
import { triggerText, type WorkflowDef } from "../../model/workflows";
import type { EntityRecord } from "../../services/entityIndex";
import { renderEntityMatch, searchEntities, type EntityMatch } from "../components/entityPicker";

/** Pick one of some notes (fuzzy over names and aliases; most recently edited first). */
export class NotePickerModal extends SuggestModal<EntityMatch> {
	constructor(
		app: App,
		private entities: EntityRecord[],
		placeholder: string,
		private onPick: (entity: EntityRecord) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): EntityMatch[] {
		return searchEntities(this.entities, query);
	}

	renderSuggestion(m: EntityMatch, el: HTMLElement): void {
		renderEntityMatch(el, m);
	}

	onChooseSuggestion(m: EntityMatch): void {
		this.onPick(m.entity);
	}
}

/** Pick a workflow to run (Run workflow on this note…). */
export class WorkflowPickerModal extends FuzzySuggestModal<WorkflowDef> {
	constructor(
		private plugin: EntitiesPlugin,
		private list: WorkflowDef[],
		private onPick: (wf: WorkflowDef) => void,
	) {
		super(plugin.app);
		this.setPlaceholder("Run a workflow…");
	}

	getItems(): WorkflowDef[] {
		return this.list;
	}

	getItemText(wf: WorkflowDef): string {
		return wf.trigger.kind === "manual" && wf.trigger.label ? wf.trigger.label : wf.name;
	}

	renderSuggestion(m: FuzzyMatch<WorkflowDef>, el: HTMLElement): void {
		el.createDiv({ text: this.getItemText(m.item) });
		el.createDiv({ cls: "oe-suggest-note", text: wf_desc(m.item, this.plugin) });
	}

	onChooseItem(wf: WorkflowDef): void {
		this.onPick(wf);
	}
}

const wf_desc = (wf: WorkflowDef, plugin: EntitiesPlugin) => (wf.trigger.kind === "manual" && wf.trigger.label && wf.trigger.label !== wf.name ? wf.name : triggerText(wf, plugin.settings.types));

/**
 * "Confirm": Yes or No (closing it is No). `rest`: notes still to go in a selection, offered "Same answer for the
 * other N notes" (`all`).
 */
export function askQuestion(app: App, title: string, text: string, rest = 0): Promise<{ yes: boolean; all: boolean }> {
	return new Promise((resolve) => {
		let answer: boolean | null = null;
		let all = false;
		const m = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.modalEl.addClass("oe-wf-ask");
				this.contentEl.createEl("p", { text });
				if (rest > 0)
					new Setting(this.contentEl).setName(`Same answer for the other ${rest === 1 ? "note" : `${rest} notes`}`).addToggle((t) => t.setValue(false).onChange((v) => (all = v)));
				const done = (yes: boolean) => {
					answer = yes;
					this.close();
				};
				new Setting(this.contentEl).addButton((b) => b.setButtonText("No").onClick(() => done(false))).addButton((b) => b.setButtonText("Yes").setCta().onClick(() => done(true)));
			}
			onClose(): void {
				resolve({ yes: answer === true, all: answer !== null && all });
			}
		})(app);
		m.open();
	});
}

/**
 * "Ask a question": a text answer (the default filled in; several lines when `multiline`). Cancel (or closing it) is
 * `answer: null`. `rest`: notes still to go in a selection, offered "Same answer for the other N notes" (`all`).
 */
export function askText(app: App, title: string, question: string, opts: { default: string; multiline: boolean; rest?: number }): Promise<{ answer: string | null; all: boolean }> {
	return new Promise((resolve) => {
		let answer: string | null = null;
		let all = false;
		const m = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.modalEl.addClass("oe-wf-ask");
				this.contentEl.createEl("p", { text: question });
				const box = opts.multiline ? this.contentEl.createEl("textarea", { cls: "oe-wf-ask-input" }) : this.contentEl.createEl("input", { type: "text", cls: "oe-wf-ask-input" });
				box.value = opts.default;
				box.setAttr("aria-label", "Answer");
				const done = () => {
					answer = box.value;
					this.close();
				};
				// Enter answers (Ctrl/Cmd+Enter with several lines).
				(box as HTMLElement).addEventListener("keydown", (e: KeyboardEvent) => {
					if (e.key === "Enter" && !e.isComposing && (!opts.multiline || e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						done();
					}
				});
				if ((opts.rest ?? 0) > 0)
					new Setting(this.contentEl).setName(`Same answer for the other ${opts.rest === 1 ? "note" : `${opts.rest} notes`}`).addToggle((t) => t.setValue(false).onChange((v) => (all = v)));
				new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton((b) => b.setButtonText("OK").setCta().onClick(done));
				window.setTimeout(() => {
					box.focus();
					// One line: typing replaces the default; several: carry on after it.
					if (opts.multiline) box.setSelectionRange(box.value.length, box.value.length);
					else box.select();
				}, 0);
			}
			onClose(): void {
				resolve({ answer, all: answer !== null && all });
			}
		})(app);
		m.open();
	});
}

/** Ask before running (a workflow's confirmation text): true when the user says Run. */
export function confirmRun(app: App, title: string, body: string, ok = "Run"): Promise<boolean> {
	return new Promise((resolve) => {
		let answered = false;
		const m = new (class extends Modal {
			onOpen(): void {
				this.setTitle(title);
				this.contentEl.createEl("p", { text: body });
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
					.addButton((b) =>
						b
							.setButtonText(ok)
							.setCta()
							.onClick(() => {
								answered = true;
								resolve(true);
								this.close();
							}),
					);
			}
			onClose(): void {
				if (!answered) resolve(false);
			}
		})(app);
		m.open();
	});
}
