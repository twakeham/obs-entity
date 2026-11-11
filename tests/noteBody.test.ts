import { describe, expect, it } from "vitest";
import { addToBody, bodyStart, parseHeading, removeAdded, type BodyAdd } from "../src/model/noteBody";

const add = (content: string, a: BodyAdd) => addToBody(content, a)?.content;
const FM = "---\nstatus: todo\n---\n";

describe("note body", () => {
	it("find where the body starts", () => {
		expect(bodyStart(FM + "Hello")).toBe(FM.length);
		expect(bodyStart("---\n---\nHi")).toBe(8);
		expect(bodyStart("Hello\n---\n")).toBe(0);
		expect(bodyStart("---\nstatus: todo\n---")).toBe(20);
	});

	it("read heading specs", () => {
		expect(parseHeading("## Log")).toEqual({ level: 2, title: "Log" });
		expect(parseHeading(" Log ")).toEqual({ level: 0, title: "Log" });
	});

	it("add at the end, on its own line or after a blank line", () => {
		expect(add(FM + "Body", { text: "- one", where: "end" })).toBe(FM + "Body\n- one\n");
		expect(add(FM + "Body\n", { text: "- one", where: "end" })).toBe(FM + "Body\n- one\n");
		expect(add(FM + "Body\n", { text: "Para", where: "end", blank: true })).toBe(FM + "Body\n\nPara\n");
		expect(add(FM + "Body\n\n", { text: "Para", where: "end", blank: true })).toBe(FM + "Body\n\nPara\n");
		// No body yet: no blank line.
		expect(add(FM, { text: "First", where: "end", blank: true })).toBe(FM + "First\n");
		expect(add("", { text: "First", where: "end" })).toBe("First\n");
	});

	it("add at the start, after the properties", () => {
		expect(add(FM + "Body\n", { text: "Top", where: "start" })).toBe(FM + "Top\nBody\n");
		expect(add(FM + "Body\n", { text: "Top", where: "start", blank: true })).toBe(FM + "Top\n\nBody\n");
		expect(add("Body\n", { text: "Top", where: "start" })).toBe("Top\nBody\n");
		expect(add("---\nstatus: todo\n---", { text: "Top", where: "start" })).toBe("---\nstatus: todo\n---\nTop\n");
	});

	it("add at the end of a heading's section, before its trailing blank lines", () => {
		const note = FM + "# Title\n\n## Log\n- a\n- b\n\n## Next\nmore\n";
		expect(add(note, { text: "- c", where: "heading", heading: "Log" })).toBe(FM + "# Title\n\n## Log\n- a\n- b\n- c\n\n## Next\nmore\n");
		expect(add(note, { text: "- c", where: "heading", heading: "## log" })).toBe(FM + "# Title\n\n## Log\n- a\n- b\n- c\n\n## Next\nmore\n");
		// A subheading is part of the section; the next heading of the same level ends it.
		const nested = "## Log\n- a\n### Old\n- x\n## Next\n";
		expect(add(nested, { text: "- c", where: "heading", heading: "Log" })).toBe("## Log\n- a\n### Old\n- x\n- c\n## Next\n");
		// The last section; an empty one.
		expect(add("## Log\n- a", { text: "- c", where: "heading", heading: "Log" })).toBe("## Log\n- a\n- c\n");
		expect(add("## Log\n\n## Next\n", { text: "- c", where: "heading", heading: "Log" })).toBe("## Log\n- c\n\n## Next\n");
		expect(add("## Log\n- a\n", { text: "Para", where: "heading", heading: "Log", blank: true })).toBe("## Log\n- a\n\nPara\n");
	});

	it("add the heading at the end when the note doesn't have it (or only at another level, or in code)", () => {
		expect(add(FM + "Body\n", { text: "- c", where: "heading", heading: "Log" })).toBe(FM + "Body\n\n## Log\n- c\n");
		expect(add(FM + "# Log\n", { text: "- c", where: "heading", heading: "### Log" })).toBe(FM + "# Log\n\n### Log\n- c\n");
		expect(add("```\n## Log\n```\n", { text: "- c", where: "heading", heading: "Log" })).toBe("```\n## Log\n```\n\n## Log\n- c\n");
		expect(add(FM, { text: "- c", where: "heading", heading: "Log" })).toBe(FM + "## Log\n- c\n");
	});

	it("keep the note's line endings, and skip empty text", () => {
		expect(add("---\r\na: 1\r\n---\r\nBody\r\n", { text: "x\ny", where: "end" })).toBe("---\r\na: 1\r\n---\r\nBody\r\nx\r\ny\r\n");
		expect(addToBody(FM, { text: "  \n", where: "end" })).toBeNull();
	});

	it("take added text out again, unless it changed or is there twice", () => {
		const before = FM + "## Log\n- a\n\n## Next\n";
		const r = addToBody(before, { text: "- c", where: "heading", heading: "Log" })!;
		expect(removeAdded(r.content, r.at, r.chunk)).toBe(before);
		// Moved by an edit above it: found by its text.
		expect(removeAdded("Intro\n" + r.content, r.at, r.chunk)).toBe("Intro\n" + before);
		expect(removeAdded(r.content.replace("- c", "- c edited"), r.at, r.chunk)).toBeNull();
		// Not where it was put, and there twice: which one is unclear.
		expect(removeAdded("- c\nIntro\n" + r.content, r.at, r.chunk)).toBeNull();
	});
});
