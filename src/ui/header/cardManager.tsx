import { MarkdownView, debounce } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { PluginContext } from "../react/context";
import { EntityCard } from "../react/EntityCard";

interface Slot {
	el: HTMLElement;
	root: Root;
	path: string | null;
	/** reading view: watches the preview sizer so the card is re-inserted if a re-render drops it */
	observer?: MutationObserver;
	observed?: HTMLElement;
}

interface ViewSlots {
	reading?: Slot;
	live?: Slot;
}

/**
 * Injects the entity info card into Markdown views:
 *  - Live Preview: inside .cm-sizer, after the properties, before the editor content
 *  - Reading view: inside .markdown-preview-sizer, after the header section
 * Source mode hides the card via CSS. Re-inserts the card if a re-render detaches it.
 */
export class CardManager {
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
		if (!path || !this.plugin.settings.showCard) return false;
		const entity = this.plugin.index.get(path);
		return !!entity && entity.type.card?.show !== false;
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
		const slots = this.slots.get(view) ?? {};
		this.slots.set(view, slots);

		const sizer = view.contentEl.querySelector<HTMLElement>(".markdown-source-view .cm-sizer");
		const content = sizer?.querySelector<HTMLElement>(":scope > .cm-contentContainer");
		if (sizer && content) slots.live = this.place(slots.live, path!, (el) => sizer.insertBefore(el, content), (el) => el.nextElementSibling === content);

		const preview = view.contentEl.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-sizer");
		if (preview) {
			const anchor = () => preview.querySelector<HTMLElement>(":scope > .mod-header");
			slots.reading = this.place(
				slots.reading,
				path!,
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

	private place(slot: Slot | undefined, path: string, insert: (el: HTMLElement) => void, inPlace: (el: HTMLElement) => boolean): Slot {
		if (!slot) {
			const el = document.createElement("div");
			el.className = "oe-card-host";
			slot = { el, root: createRoot(el), path: null };
		}
		if (!slot.el.isConnected || !inPlace(slot.el)) insert(slot.el);
		if (slot.path !== path) {
			slot.path = path;
			slot.root.render(
				<PluginContext.Provider value={this.plugin}>
					<EntityCard key={path} path={path} />
				</PluginContext.Provider>,
			);
		}
		return slot;
	}

	private clear(view: MarkdownView): void {
		const slots = this.slots.get(view);
		if (!slots) return;
		for (const slot of [slots.live, slots.reading]) {
			if (!slot) continue;
			slot.observer?.disconnect();
			slot.root.unmount();
			slot.el.remove();
		}
		this.slots.delete(view);
	}
}
