import { MarkdownView, Notice, setIcon, type App } from "obsidian";
import { applyEdit, embedWideEdit, isWideAlt } from "../../model/viewEmbed";

/** The note view an embed is shown in. */
function hostView(app: App, embed: HTMLElement): MarkdownView | null {
	let host: MarkdownView | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (!host && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(embed)) host = leaf.view;
	});
	return host;
}

/** Turn an embedded view's `|wide` on or off, in the note it's embedded in (Live Preview: as an undoable edit). */
export async function toggleEmbedWide(app: App, embed: HTMLElement): Promise<void> {
	const src = embed.getAttribute("src");
	const host = hostView(app, embed);
	if (!src || !host?.file) {
		new Notice("Couldn't find the embed to change.");
		return;
	}
	const wide = !isWideAlt(embed.getAttribute("alt"));
	if (host.getMode() === "source") {
		const editor = host.editor;
		const cm = (editor as unknown as { cm?: { posAtDOM(node: Node): number } }).cm;
		let near: number | undefined;
		try {
			near = cm?.posAtDOM(embed);
		} catch {
			near = undefined;
		}
		const edit = embedWideEdit(editor.getValue(), src, wide, { near });
		if (!edit) return void new Notice("Couldn't find the embed to change.");
		editor.replaceRange(edit.insert, editor.offsetToPos(edit.from), editor.offsetToPos(edit.to));
		return;
	}
	// Reading view: which of the note's embeds of this link it is, in page order.
	const same = [...host.containerEl.querySelectorAll<HTMLElement>(".markdown-reading-view .internal-embed")].filter((e) => e.getAttribute("src") === src && !e.parentElement?.closest(".internal-embed"));
	const index = Math.max(0, same.indexOf(embed));
	let found = true;
	await app.vault.process(host.file, (text) => {
		const edit = embedWideEdit(text, src, wide, { index });
		if (!edit) {
			found = false;
			return text;
		}
		return applyEdit(text, edit);
	});
	if (!found) new Notice("Couldn't find the embed to change.");
}

/** The Full width button, left of the embed's open-link button (added once per embed, kept up to date). */
export function wideButton(app: App, embed: HTMLElement): void {
	let btn = embed.querySelector<HTMLElement>(":scope > .oe-embed-wide");
	if (!btn) {
		btn = embed.createDiv({ cls: "oe-embed-wide clickable-icon", attr: { role: "button", tabindex: "0" } });
		setIcon(btn, "move-horizontal");
		// Keep the editor from moving the cursor into the embed (which would show its source).
		btn.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		const run = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			void toggleEmbedWide(app, embed);
		};
		btn.addEventListener("click", run);
		btn.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && run(e));
	}
	const wide = isWideAlt(embed.getAttribute("alt"));
	btn.toggleClass("is-active", wide);
	btn.setAttribute("aria-pressed", String(wide));
	btn.setAttribute("aria-label", wide ? "Back to normal width" : "Full width");
}

export function removeWideButton(embed: HTMLElement): void {
	embed.querySelector(":scope > .oe-embed-wide")?.remove();
}
