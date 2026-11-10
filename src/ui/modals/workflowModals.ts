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
