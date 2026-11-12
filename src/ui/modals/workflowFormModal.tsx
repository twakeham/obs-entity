import { Modal } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { emptyFormValues } from "../../model/defaults";
import { todayDays } from "../../model/formConditions";
import { buttonIcon, formType, type FormTrigger, type WorkflowDef } from "../../model/workflows";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { CreateForm } from "../react/CreateForm";

/**
 * A form workflow's form ("Fill in a form"): its fields in its layout, with the properties form's controls, required
 * fields, rules, conditions and defaults; its title, and its button to send it. Resolves to the answers (as
 * frontmatter stores them, by field key), or null when it's cancelled.
 */
export function askForm(plugin: EntitiesPlugin, wf: WorkflowDef & { trigger: FormTrigger }): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		let done = false;
		const finish = (v: Record<string, unknown> | null) => {
			if (done) return;
			done = true;
			resolve(v);
		};
		const t = wf.trigger;
		const type = formType(t);
		const initial = emptyFormValues(type, plugin.settings.groups, "", { today: todayDays(), dates: plugin.dates });
		let root: Root | null = null;
		let submit: (() => void) | null = null;
		const modal = new (class extends Modal {
			onOpen(): void {
				this.modalEl.addClass("oe-create-modal", "oe-wf-form-modal");
				this.scope.register(["Mod"], "Enter", (evt) => {
					evt.preventDefault();
					submit?.();
					return false;
				});
				root = createRoot(this.contentEl);
				root.render(
					<PluginContext.Provider value={plugin}>
						<CreateForm
							type={type}
							initial={initial}
							workflowForm={{ title: t.title.trim() || wf.name, button: t.button, icon: buttonIcon(wf) }}
							onSubmitReady={(fn) => {
								submit = fn;
							}}
							onCancel={() => this.close()}
							onSubmit={async (_type, values) => {
								finish(values.fields as Record<string, unknown>);
								this.close();
							}}
						/>
					</PluginContext.Provider>,
				);
			}
			onClose(): void {
				root?.unmount();
				root = null;
				this.contentEl.empty();
				finish(null);
			}
		})(plugin.app);
		modal.open();
	});
}
