/**
 * Options for embedded view notes, written as the embed link's display text: `wide` (full width) and `bare` (no
 * toolbar or footer), e.g. `![[Open tasks|wide bare]]`. These helpers read them, find a note's embeds of a link and
 * work out the edit that turns `wide` on or off.
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

export const EMBED_OPTIONS = ["wide", "bare"] as const;
export type EmbedOption = (typeof EMBED_OPTIONS)[number];

/**
 * The options in an embed's display text: its words, when every one is an option ("wide bare", "Bare, wide").
 * Other display text (and Obsidian's default, the link itself) gives none.
 */
export function embedOptions(alt: string | null | undefined): Set<EmbedOption> {
	const words = (alt ?? "").trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
	return new Set(words.length && words.every((w) => (EMBED_OPTIONS as readonly string[]).includes(w)) ? (words as EmbedOption[]) : []);
}

/** Whether an embed's display text asks for full width. */
export const isWideAlt = (alt: string | null | undefined): boolean => embedOptions(alt).has("wide");

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
	// Other options stay (`wide` goes first); other display text is replaced.
	const rest = [...embedOptions(link.alt)].filter((o) => o !== "wide");
	const opts = wide ? ["wide", ...rest] : rest;
	const insert = `![[${link.target}${opts.length ? `${inTable ? "\\|" : "|"}${opts.join(" ")}` : ""}]]`;
	return { from: link.from, to: link.to, insert };
}

/** `text` with the edit applied. */
export const applyEdit = (text: string, e: { from: number; to: number; insert: string }): string => text.slice(0, e.from) + e.insert + text.slice(e.to);
