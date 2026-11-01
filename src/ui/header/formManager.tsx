import { MarkdownView, debounce } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { EntityForm } from "../react/EntityForm";

interface Slot {
	el: HTMLElement;
	root: Root;
	path: string | null;
	/** reading view: watches the preview sizer so the form is re-inserted if a re-render drops it */
	observer?: MutationObserver;
	observed?: HTMLElement;
	/** Live Preview: keeps the form lined up with the note's text when the editor resizes */
	resize?: ResizeObserver;
}

interface ViewSlots {
	reading?: Slot;
	live?: Slot;
}

/**
 * In Live Preview, give the form the same left edge and width as the note's text. Themes set the readable
 * line width in different ways, so measure a line of the note rather than guessing from CSS variables.
 */
function alignToText(el: HTMLElement, sizer: HTMLElement): void {
	const ref = sizer.querySelector<HTMLElement>(".cm-content > .cm-line") ?? sizer.querySelector<HTMLElement>(":scope > .inline-title");
	if (!ref || !el.isConnected) return;
	const s = sizer.getBoundingClientRect();
	const r = ref.getBoundingClientRect();
	if (r.width === 0) return;
	el.style.maxWidth = "none";
	el.style.marginLeft = `${Math.round(r.left - s.left - parseFloat(getComputedStyle(sizer).paddingLeft || "0"))}px`;
	el.style.marginRight = "0";
	el.style.width = `${Math.round(r.width)}px`;
}

/**
 * Puts the entity properties form into Markdown views of entity notes, in place of Obsidian's Properties block
 * (hidden via the `oe-has-form` class on the view):
 *  - Live Preview: inside .cm-sizer, after the (hidden) properties, before the editor content
 *  - Reading view: inside .markdown-preview-sizer, after the header section; read-only until the pencil is clicked
 * Source mode keeps the raw YAML and hides the form via CSS. Re-inserts the form if a re-render detaches it.
 */
export class FormManager {
	private slots = new WeakMap<MarkdownView, ViewSlots>();
	private views = new Set<MarkdownView>();
	readonly refresh = debounce(() => this.refreshAll(), 50, true);

	constructor(private plugin: EntitiesPlugin) {}

	load(): void {
		const { app } = this.plugin;
		const r = () => {
			this.refresh();
		};
		this.plugin.registerEvent(app.workspace.on("layout-change", r));
		this.plugin.registerEvent(app.workspace.on("file-open", r));
		this.plugin.registerEvent(app.workspace.on("active-leaf-change", r));
		this.plugin.registerEvent(this.plugin.index.on("updated", r));
		// Reading view re-renders can drop injected elements; post-processors run on every render.
		this.plugin.registerMarkdownPostProcessor(() => {
			this.refresh();
		});
		app.workspace.onLayoutReady(r);
	}

	unload(): void {
		for (const view of this.views) this.clear(view);
		this.views.clear();
	}

	private enabledFor(path: string | null): boolean {
		return !!path && this.plugin.settings.useForm && !!this.plugin.index.get(path);
	}

	refreshAll(): void {
		const live = new Set<MarkdownView>();
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			live.add(view);
			this.update(view);
		}
		for (const view of this.views) if (!live.has(view)) this.clear(view);
		this.views = live;
	}

	private update(view: MarkdownView): void {
		const path = view.file?.path ?? null;
		if (!this.enabledFor(path)) {
			this.clear(view);
			return;
		}
		view.containerEl.addClass("oe-has-form");
		const slots = this.slots.get(view) ?? {};
		this.slots.set(view, slots);

		const sizer = view.contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-sizer");
		const content = sizer?.querySelector<HTMLElement>(":scope > .cm-contentContainer");
		if (sizer && content) {
			const slot = (slots.live = this.place(slots.live, path!, "live", (el) => sizer.insertBefore(el, content), (el) => el.nextElementSibling === content));
			if (slot.observed !== sizer) {
				slot.resize?.disconnect();
				slot.resize = new ResizeObserver(() => alignToText(slot.el, sizer));
				slot.resize.observe(sizer);
				slot.observed = sizer;
			}
			alignToText(slot.el, sizer);
		}

		const preview = view.contentEl.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-sizer");
		if (preview) {
			const anchor = () => preview.querySelector<HTMLElement>(":scope > .mod-header");
			slots.reading = this.place(
				slots.reading,
				path!,
				"reading",
				(el) => {
					const header = anchor();
					if (header) header.after(el);
					else preview.prepend(el);
				},
				(el) => el.parentElement === preview && (anchor() ? el.previousElementSibling === anchor() : true),
			);
			const slot = slots.reading;
			if (slot.observed !== preview) {
				slot.observer?.disconnect();
				slot.observer = new MutationObserver(() => {
					if (!slot.el.isConnected || slot.el.parentElement !== preview) this.refresh();
				});
				slot.observer.observe(preview, { childList: true });
				slot.observed = preview;
			}
		}
	}

	private place(slot: Slot | undefined, path: string, mode: "live" | "reading", insert: (el: HTMLElement) => void, inPlace: (el: HTMLElement) => boolean): Slot {
		if (!slot) {
			const el = document.createElement("div");
			el.className = "oe-form-host";
			slot = { el, root: createRoot(el), path: null };
		}
		if (!slot.el.isConnected || !inPlace(slot.el)) insert(slot.el);
		if (slot.path !== path) {
			slot.path = path;
			slot.root.render(
				<PluginContext.Provider value={this.plugin}>
					<EntityForm key={path} path={path} mode={mode} />
				</PluginContext.Provider>,
			);
		}
		return slot;
	}

	private clear(view: MarkdownView): void {
		view.containerEl.removeClass("oe-has-form");
		const slots = this.slots.get(view);
		if (!slots) return;
		for (const slot of [slots.live, slots.reading]) {
			if (!slot) continue;
			slot.observer?.disconnect();
			slot.resize?.disconnect();
			slot.root.unmount();
			slot.el.remove();
		}
		this.slots.delete(view);
	}
}
