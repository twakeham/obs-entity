/** A fenced `entity-view` block inside a note's text, by line. */
export interface BlockSpan {
	/** line of the opening fence */
	start: number;
	/** line of the closing fence (or the last line when unclosed) */
	end: number;
	/** what each line starts with: indentation and/or callout ">" markers */
	prefix: string;
	/** the block's content, without the prefix */
	inner: string;
	/** the opening fence (e.g. "```"), to close an unclosed block */
	fence: string;
	closed: boolean;
}

const OPEN = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})entity-view[ \t]*$/;

/** Every `entity-view` block in a note. */
export function findViewBlocks(text: string): BlockSpan[] {
	const lines = text.split(/\r?\n/);
	const out: BlockSpan[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = OPEN.exec(lines[i]);
		if (!m) continue;
		const prefix = m[1];
		const fence = m[2];
		let end = lines.length;
		let closed = false;
		for (let j = i + 1; j < lines.length; j++) {
			const body = lines[j].startsWith(prefix) ? lines[j].slice(prefix.length) : lines[j].replace(/^[ \t>]*/, "");
			if (body.trim().startsWith(fence[0].repeat(fence.length)) && body.trim().replace(new RegExp(`^\\${fence[0]}+`), "") === "") {
				end = j;
				closed = true;
				break;
			}
		}
		const inner = lines
			.slice(i + 1, end)
			.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l))
			.join("\n");
		out.push({ start: i, end, prefix, inner, fence, closed });
		i = end;
	}
	return out;
}

/**
 * Set (or with null, remove) the top-level `place:` key in a block's content, touching only that line so the rest
 * keeps its formatting.
 */
export function setBlockPlace(inner: string, place: string | null): string {
	const lines = inner.replace(/\r\n/g, "\n").split("\n");
	const kept = lines.filter((l) => !/^place[ \t]*:/.test(l));
	if (place === null) return kept.join("\n");
	while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
	kept.push(`place: ${JSON.stringify(place)}`);
	return kept.join("\n");
}

/**
 * Replace the content of one `entity-view` block. The block is the one opening at `lineStart` when given and
 * present, otherwise the one whose content matches `source`. Returns null when it can't be found.
 */
export function replaceViewBlock(text: string, target: { lineStart?: number | null; source: string }, content: string): string | null {
	const blocks = findViewBlocks(text);
	const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
	const block = blocks.find((b) => b.start === target.lineStart) ?? blocks.find((b) => norm(b.inner) === norm(target.source));
	if (!block) return null;
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const body = content
		.replace(/\r\n/g, "\n")
		.replace(/\n+$/, "")
		.split("\n")
		.map((l) => block.prefix + l);
	const tail = block.closed ? lines.slice(block.end) : [`${block.prefix}${block.fence}`];
	return [...lines.slice(0, block.start + 1), ...body, ...tail].join(nl);
}
