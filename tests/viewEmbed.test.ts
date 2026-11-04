import { describe, expect, it } from "vitest";
import { applyEdit, embedLinks, embedOptions, embedWideEdit, isWideAlt } from "../src/model/viewEmbed";

const toggle = (text: string, src: string, wide: boolean, pick?: { near?: number; index?: number }) => {
	const e = embedWideEdit(text, src, wide, pick);
	return e ? applyEdit(text, e) : null;
};

describe("wide view embeds", () => {
	it("reads |wide", () => {
		expect(isWideAlt("wide")).toBe(true);
		expect(isWideAlt(" Wide ")).toBe(true);
		expect(isWideAlt("Open tasks")).toBe(false);
		expect(isWideAlt(null)).toBe(false);
	});

	it("finds a note's embeds of a link, and only those", () => {
		const text = "![[Open tasks]]\n[[Open tasks]]\n![[Open tasks|wide]]\n![[Other]]\n![[Open tasks#Due]]";
		expect(embedLinks(text, "Open tasks").map((l) => [l.from, l.alt])).toEqual([
			[0, null],
			[31, "wide"],
		]);
		expect(embedLinks(text, "Open tasks#Due")).toHaveLength(1);
	});

	it("turns wide on and off", () => {
		expect(toggle("Intro\n\n![[Open tasks]]\n", "Open tasks", true)).toBe("Intro\n\n![[Open tasks|wide]]\n");
		expect(toggle("![[Open tasks|wide]]", "Open tasks", false)).toBe("![[Open tasks]]");
		expect(toggle("![[Open tasks|some text]]", "Open tasks", true)).toBe("![[Open tasks|wide]]");
		expect(toggle("![[Nope]]", "Open tasks", true)).toBeNull();
	});

	it("picks the embed nearest a position, or by index", () => {
		const text = "![[V]]\n\n![[V]]\n";
		expect(toggle(text, "V", true, { near: 8 })).toBe("![[V]]\n\n![[V|wide]]\n");
		expect(toggle(text, "V", true, { near: 0 })).toBe("![[V|wide]]\n\n![[V]]\n");
		expect(toggle(text, "V", true, { index: 1 })).toBe("![[V]]\n\n![[V|wide]]\n");
		expect(toggle(text, "V", true, { index: 5 })).toBeNull();
	});

	it("escapes the pipe inside a table", () => {
		expect(toggle("| a | ![[V]] |", "V", true)).toBe("| a | ![[V\\|wide]] |");
		expect(toggle("| a | ![[V\\|wide]] |", "V", false)).toBe("| a | ![[V]] |");
	});

	it("reads options only when every word is one", () => {
		expect([...embedOptions("wide bare")]).toEqual(["wide", "bare"]);
		expect([...embedOptions("Bare, Wide")]).toEqual(["bare", "wide"]);
		expect(embedOptions("Wide open spaces").size).toBe(0);
		expect(embedOptions("Open tasks").size).toBe(0);
		expect(isWideAlt("bare wide")).toBe(true);
	});

	it("keeps bare when wide is turned on or off", () => {
		expect(toggle("![[V|bare]]", "V", true)).toBe("![[V|wide bare]]");
		expect(toggle("![[V|bare wide]]", "V", false)).toBe("![[V|bare]]");
		expect(toggle("![[V|wide]]", "V", false)).toBe("![[V]]");
	});
});
