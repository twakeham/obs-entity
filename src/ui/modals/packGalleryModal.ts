import { Modal, Notice, setIcon } from "obsidian";
import { GALLERY } from "../../model/gallery";
import type { TypePack } from "../../model/packs";
import { installGalleryPack } from "../../services/packFiles";
import type EntitiesPlugin from "../../main";

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/**
 * The pack gallery: the bundled packs as cards (what each is for and holds), each installed with one click. On first
 * run it's the "Start from a pack" picker: choosing a pack starts the vault with it; closing it starts empty.
 */
export class PackGalleryModal extends Modal {
	private busy = false;
	private grid!: HTMLElement;

	constructor(
		private plugin: EntitiesPlugin,
		private firstRun = false,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.modalEl.addClass("oe-gallery-modal");
		this.setTitle(this.firstRun ? "Start from a pack" : "Entity packs");
		const { contentEl } = this;
		contentEl.createEl("p", {
			cls: "oe-gallery-intro",
			text: this.firstRun
				? "Welcome to Obsidian Entities. Pick a pack to start with: types of notes with their fields and links, plus views and workflows. Change anything afterwards, add more packs later (Entity types → New → Browse packs…), or start empty and make your own types."
				: "Ready-made types with their views and workflows. A pack is added beside your types: a key you already use gets a number, general types (people, authors, topics) you already have are reused, and its workflows come in switched off.",
		});
		this.grid = contentEl.createDiv({ cls: "oe-gallery-grid" });
		this.render();
		if (this.firstRun) {
			const foot = contentEl.createDiv({ cls: "oe-gallery-foot" });
			foot.createEl("button", { text: "Start empty" }).addEventListener("click", () => this.close());
		}
	}

	private installed(pack: TypePack): boolean {
		return this.plugin.settings.types.some((t) => t.pack === pack.id);
	}

	private render(): void {
		this.grid.empty();
		for (const pack of GALLERY) {
			const card = this.grid.createDiv({ cls: "oe-gallery-card", attr: { "data-pack": pack.id ?? "" } });
			const head = card.createDiv({ cls: "oe-gallery-head" });
			setIcon(head.createSpan({ cls: "oe-gallery-icon" }), pack.icon ?? "package");
			head.createEl("h3", { text: pack.name ?? "Pack" });
			card.createEl("p", { cls: "oe-gallery-desc", text: pack.description ?? "" });
			const types = card.createDiv({ cls: "oe-gallery-types", attr: { "aria-label": "Types" } });
			for (const t of pack.types) {
				const chip = types.createSpan({ cls: "oe-gallery-type" });
				const icon = chip.createSpan({ cls: "oe-gallery-type-icon" });
				icon.style.setProperty("--oe-type-color", t.color);
				setIcon(icon, t.icon);
				chip.createSpan({ text: t.plural });
			}
			const extras = [pack.views?.length ? plural(pack.views.length, "view") : "", pack.workflows?.length ? plural(pack.workflows.length, "workflow") : ""].filter(Boolean);
			const foot = card.createDiv({ cls: "oe-gallery-card-foot" });
			foot.createSpan({ cls: "oe-gallery-count", text: [plural(pack.types.length, "type"), ...extras].join(" · ") });
			const done = this.installed(pack);
			const btn = foot.createEl("button", { text: done ? "Installed" : this.firstRun ? "Start with this" : "Install", cls: done ? "" : "mod-cta" });
			btn.disabled = done;
			btn.setAttr("aria-label", done ? `${pack.name} is installed` : `Install ${pack.name}`);
			btn.addEventListener("click", () => void this.install(pack, btn));
		}
	}

	private async install(pack: TypePack, btn: HTMLButtonElement): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		btn.disabled = true;
		btn.setText("Installing…");
		try {
			new Notice(await installGalleryPack(this.plugin, pack), 8000);
		} catch (e) {
			new Notice(`Couldn't install ${pack.name}: ${(e as Error).message}`);
		}
		this.busy = false;
		if (this.firstRun) {
			this.close();
			void this.plugin.activateBrowser();
		} else this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		// A first run is over once the picker closes, whatever was chosen: saved, it isn't shown again.
		if (this.firstRun) void this.plugin.saveSettings();
	}
}
