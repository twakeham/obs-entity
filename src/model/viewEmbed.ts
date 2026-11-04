/**
 * Embedded view notes can be shown full width: the embed link's display text is `wide` (`![[Open tasks|wide]]`).
 * These helpers find a note's embeds of a link and work out the edit that turns `|wide` on or off.
 */

export interface EmbedLink {
	from: number;
	to: number;
	/** the link text as written (before any `|`), e.g. "Open tasks" or "Views/Open tasks#Due" */
	target: string;
	/** the display text after `|`, or null */
	alt: string | null;
	/** written with an escaped pipe (`\|`), as inside a table */
	escaped: boolean;
}

const EMBED_RE = /!\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/g;

/** Whether an embed's display text asks for full width. */
export const isWideAlt = (alt: string | null | undefined): boolean => !!alt && alt.trim().toLowerCase() === "wide";

/** The embeds in `text` whose link text is `src` (as Obsidian puts it in the embed's `src` attribute). */
export function embedLinks(text: string, src: string): EmbedLink[] {
	const out: EmbedLink[] = [];
	const want = src.trim();
	for (const m of text.matchAll(EMBED_RE)) {
		const raw = m[1];
		const escaped = raw.endsWith("\\");
		const target = (escaped ? raw.slice(0, -1) : raw).trim();
		if (target !== want) continue;
		out.push({ from: m.index!, to: m.index! + m[0].length, target: escaped ? raw.slice(0, -1) : raw, alt: m[2] ?? null, escaped });
	}
	return out;
}

/**
 * The edit that makes one embed of `src` wide or normal: the one nearest `near` (an offset, e.g. where the editor
 * shows it), else the `index`-th (0 when there's only one). Null when there's no such embed.
 */
export function embedWideEdit(text: string, src: string, wide: boolean, pick: { near?: number; index?: number } = {}): { from: number; to: number; insert: string } | null {
	const links = embedLinks(text, src);
	if (!links.length) return null;
	let link: EmbedLink | undefined;
	if (pick.near !== undefined) {
		const near = pick.near;
		link = links.reduce((a, b) => (Math.abs(b.from - near) < Math.abs(a.from - near) ? b : a));
	} else link = links.length === 1 ? links[0] : links[pick.index ?? 0];
	if (!link) return null;
	// A pipe inside a table row has to be escaped.
	const lineStart = text.lastIndexOf("\n", link.from - 1) + 1;
	const inTable = link.escaped || text.slice(lineStart, link.from).trimStart().startsWith("|");
	const insert = `![[${link.target}${wide ? `${inTable ? "\\|" : "|"}wide` : ""}]]`;
	return { from: link.from, to: link.to, insert };
}

/** `text` with the edit applied. */
export const applyEdit = (text: string, e: { from: number; to: number; insert: string }): string => text.slice(0, e.from) + e.insert + text.slice(e.to);
