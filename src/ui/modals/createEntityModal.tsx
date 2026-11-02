import { Modal, Notice, type TFile } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { EntityFormValues } from "../../model/frontmatter";
import type { EntityTypeDef } from "../../model/types";
import { emptyFormValues } from "../../services/entityFactory";
import type EntitiesPlugin from "../../main";
import { TypePickerModal } from "../components/entityPicker";
import { PluginContext } from "../react/context";
import { CreateForm } from "../react/CreateForm";

/**
 * Create an entity: name, status and the type's fields, laid out like its properties form (its layout's frames
 * marked "Show in create dialog", or the fields set to show in the dialog), with the same controls.
 */
export class CreateEntityModal extends Modal {
	private values: EntityFormValues;
	private root: Root | null = null;
	private submit: (() => void) | null = null;

	constructor(
		private plugin: EntitiesPlugin,
		private type: EntityTypeDef,
		initial: Partial<EntityFormValues> = {},
		private onCreated?: (file: TFile) => void,
	) {
		super(plugin.app);
		const blank = emptyFormValues(type, plugin.settings.groups);
		this.values = { ...blank, ...initial, fields: { ...blank.fields, ...(initial.fields ?? {}) } };
	}

	onOpen(): void {
		this.modalEl.addClass("oe-create-modal");
		this.scope.register(["Mod"], "Enter", (evt) => {
			evt.preventDefault();
			this.submit?.();
			return false;
		});
		this.root = createRoot(this.contentEl);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<CreateForm
					type={this.type}
					initial={this.values}
					onPickType={(done) => new TypePickerModal(this.plugin, done).open()}
					onSubmitReady={(fn) => {
						this.submit = fn;
					}}
					onCancel={() => this.close()}
					onSubmit={async (type, values) => {
						try {
							const file = await this.plugin.factory.createEntity(type, values);
							this.close();
							this.onCreated?.(file);
						} catch (e) {
							new Notice(`Could not create ${type.name.toLowerCase()}: ${(e as Error).message}`);
						}
					}}
				/>
			</PluginContext.Provider>,
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}