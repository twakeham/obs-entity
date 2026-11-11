/**
 * Adding text to a note's body (the workflow step "Add text to a note") and taking it out again (undo). Pure: works
 * on the note's whole content (frontmatter included) and keeps its line endings.
 */

/** Where the text goes: the end, the start (after the properties), or the end of a heading's section. */
export type AddWhere = "end" | "start" | "heading";

/** One piece of text to add. `heading`: "Log" (any level) or "## Log" (that level). `blank`: a blank line separates it. */
export interface BodyAdd {
	text: string;
	where: AddWhere;
	heading?: string;
	blank?: boolean;
}

/** What was added: the new content, and where the added text (`chunk`) is in it, for undo. */
export interface BodyAdded {
	content: string;
	at: number;
	chunk: string;
}

/** Where the body starts: after the frontmatter block (and its line break), else 0. */
export function bodyStart(content: string): number {
	const m = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(content);
	return m ? m[0].length : 0;
}

interface Line {
	start: number;
	text: string;
}

function linesFrom(content: string, from: number): Line[] {
	const out: Line[] = [];
	let pos = from;
	while (pos < content.length) {
		const nl = content.indexOf("\n", pos);
		const end = nl < 0 ? content.length : nl;
		out.push({ start: pos, text: content.slice(pos, end).replace(/\r$/, "") });
		pos = nl < 0 ? content.length : nl + 1;
	}
	return out;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** "## Log" → level 2, "Log"; "Log" → any level (0). */
export function parseHeading(spec: string): { level: number; title: string } {
	const m = /^(#{1,6})[ \t]+(.*)$/.exec(spec.trim());
	return m ? { level: m[1].length, title: m[2].trim() } : { level: 0, title: spec.trim() };
}

/** The body's headings (outside code blocks): line index, level, title. */
function headings(lines: Line[]): { i: number; level: number; title: string }[] {
	const out: { i: number; level: number; title: string }[] = [];
	let fence: string | null = null;
	lines.forEach((l, i) => {
		const f = FENCE.exec(l.text);
		if (f) {
			if (!fence) fence = f[1][0];
			else if (f[1][0] === fence) fence = null;
			return;
		}
		if (fence) return;
		const h = HEADING.exec(l.text);
		if (h) out.push({ i, level: h[1].length, title: h[2].trim() });
	});
	return out;
}

/**
 * Add text to a note's content. At the end; at the start of the body; or at the end of a heading's section (before
 * its trailing blank lines; a heading not there is added at the end, then the text). The text is on its own line,
 * with a blank line before it when `blank` (after it, at the start). Null when the text is empty.
 */
export function addToBody(content: string, add: BodyAdd): BodyAdded | null {
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const text = add.text.replace(/\r?\n/g, eol).replace(/\s+$/, "");
	if (!text.trim()) return null;
	const b0 = bodyStart(content);
	const hasBody = content.slice(b0).trim() !== "";
	/** Text added at the end: a line break first if the content doesn't end with one; then a blank line if wanted. */
	const atEnd = (chunkText: string, blank: boolean): BodyAdded => {
		const at = content.length;
		let prefix = at > 0 && !content.endsWith("\n") ? eol : "";
		if (blank && hasBody && !(content + prefix).endsWith(eol + eol)) prefix += eol;
		const chunk = prefix + chunkText + eol;
		return { content: content + chunk, at, chunk };
	};
	if (add.where === "end") return atEnd(text, !!add.blank);
	if (add.where === "start") {
		const prefix = b0 > 0 && !content.slice(0, b0).endsWith("\n") ? eol : "";
		const chunk = prefix + text + eol + (add.blank && hasBody ? eol : "");
		return { content: content.slice(0, b0) + chunk + content.slice(b0), at: b0, chunk };
	}
	const { level, title } = parseHeading(add.heading ?? "");
	const lines = linesFrom(content, b0);
	const hs = headings(lines);
	const h = hs.find((x) => x.title.toLowerCase() === title.toLowerCase() && (!level || x.level === level));
	if (!h) {
		const line = `${"#".repeat(level || 2)} ${title}`;
		return atEnd(line + eol + (add.blank ? eol : "") + text, true);
	}
	// The section ends at the next heading of the same level or higher, or the end; the text goes before its trailing blank lines.
	const next = hs.find((x) => x.i > h.i && x.level <= h.level);
	let j = next ? next.i : lines.length;
	while (j - 1 > h.i && lines[j - 1].text.trim() === "") j--;
	const at = j < lines.length ? lines[j].start : content.length;
	const prefix = at > 0 && !content.slice(0, at).endsWith("\n") ? eol : "";
	const chunk = prefix + (add.blank ? eol : "") + text + eol;
	return { content: content.slice(0, at) + chunk + content.slice(at), at, chunk };
}

/**
 * Take added text out again: where it was put if it's still there, else wherever it is if it's there once. Null
 * when it isn't there (edited since) or is there more than once (which one is unclear).
 */
export function removeAdded(content: string, at: number, chunk: string): string | null {
	if (content.slice(at, at + chunk.length) === chunk) return content.slice(0, at) + content.slice(at + chunk.length);
	const i = content.indexOf(chunk);
	if (i < 0 || content.indexOf(chunk, i + 1) >= 0) return null;
	return content.slice(0, i) + content.slice(i + chunk.length);
}
