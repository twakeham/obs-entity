/** Format a link target as a frontmatter wikilink string. */
export function toWikilink(linktext: string, display?: string): string {
	return display && display !== linktext ? `[[${linktext}|${display}]]` : `[[${linktext}]]`;
}

export interface ParsedLink {
	path: string;
	display?: string;
	subpath?: string;
}

const WIKILINK_RE = /^\s*\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/;

/**
 * Parse a frontmatter value that may be a wikilink ("[[Target|Alias]]"),
 * a markdown link ("[x](Target.md)") or a bare note name.
 */
export function parseLink(value: unknown): ParsedLink | null {
	if (typeof value !== "string") return null;
	const s = value.trim();
	if (!s) return null;
	const m = WIKILINK_RE.exec(s);
	if (m) {
		const path = m[1].trim();
		if (!path) return null;
		return { path, subpath: m[2] || undefined, display: m[3]?.trim() || undefined };
	}
	const md = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(s);
	if (md) return { path: decodeURI(md[2]).replace(/\.md$/, ""), display: md[1] || undefined };
	if (s.includes("[[") || s.includes("]]")) return null;
	return { path: s };
}

/** Normalise a single frontmatter value or list into an array of raw values. */
export function asArray(value: unknown): unknown[] {
	if (value === undefined || value === null || value === "") return [];
	return Array.isArray(value) ? value : [value];
}

export interface LabelledLink {
	target: string;
	label?: string;
}

/** Strip characters that would break a wikilink alias. */
export function cleanLabel(label: string): string {
	return label.replace(/[|[\]]/g, "").trim();
}

/** Format a labelled relationship as a wikilink whose alias is the label: "[[Vex|rival]]". */
export function toLabelledWikilink(linktext: string, label?: string): string {
	const l = label ? cleanLabel(label) : "";
	return l ? `[[${linktext}|${l}]]` : `[[${linktext}]]`;
}

/**
 * Read a labelled relation entry. The label is the link alias: "[[Vex|rival]]".
 * The legacy object form { target: "[[Vex]]", label: "rival" } is also accepted.
 */
export function parseLabelledEntry(value: unknown): { link: ParsedLink; label?: string } | null {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		const link = parseLink(v.target);
		if (!link) return null;
		const label = typeof v.label === "string" && v.label.trim() ? v.label.trim() : undefined;
		return { link, label };
	}
	const link = parseLink(value);
	return link ? { link, label: link.display } : null;
}
