import { describe, expect, it } from "vitest";
import { findViewBlocks, replaceViewBlock } from "../src/model/viewBlock";

const NOTE = ["# Projects", "", "```entity-view", "types: [project]", "columns: [name]", "```", "", "Notes here.", "", "```entity-view", "types: [person]", "```", ""].join("\n");

describe("view blocks", () => {
	it("finds blocks with their lines and content", () => {
		expect(findViewBlocks(NOTE).map((b) => [b.start, b.end, b.inner])).toEqual([
			[2, 5, "types: [project]\ncolumns: [name]"],
			[9, 11, "types: [person]"],
		]);
	});

	it("replaces the block at a line, or the one with matching content", () => {
		const byLine = replaceViewBlock(NOTE, { lineStart: 9, source: "x" }, "types: [place]\n");
		expect(byLine?.split("\n").slice(9, 12)).toEqual(["```entity-view", "types: [place]", "```"]);
		const bySource = replaceViewBlock(NOTE, { lineStart: 4, source: "types: [project]\ncolumns: [name]\n" }, "a: 1\nb: 2");
		expect(bySource?.split("\n").slice(2, 6)).toEqual(["```entity-view", "a: 1", "b: 2", "```"]);
		expect(bySource?.endsWith("Notes here.\n\n```entity-view\ntypes: [person]\n```\n")).toBe(true);
		expect(replaceViewBlock(NOTE, { source: "nope" }, "x")).toBeNull();
	});

	it("keeps callout prefixes, CRLF line endings and longer fences", () => {
		const callout = "> [!note]\n> ```entity-view\n> types: [a]\n> ```\nafter";
		expect(replaceViewBlock(callout, { lineStart: 1, source: "" }, "types: [b]\nsort: []")).toBe("> [!note]\n> ```entity-view\n> types: [b]\n> sort: []\n> ```\nafter");
		const crlf = "x\r\n````entity-view\r\nold: 1\r\n````\r\ny";
		expect(replaceViewBlock(crlf, { source: "old: 1" }, "new: 2")).toBe("x\r\n````entity-view\r\nnew: 2\r\n````\r\ny");
		expect(replaceViewBlock("```entity-view\nold: 1", { source: "old: 1" }, "new: 2")).toBe("```entity-view\nnew: 2\n```");
	});
});
