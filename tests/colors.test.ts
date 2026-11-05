import { describe, expect, it } from "vitest";
import { choiceColor, isPaletteColor, pruneColors, renameColor, statusColor, statusColorAmong, withColor } from "../src/model/colors";

const groups = [
	{ key: "work", statusColors: { "in-progress": "blue" as const, blocked: "red" as const } },
	{ key: "home", statusColors: undefined },
];

describe("choice and status colours", () => {
	it("look up a choice's colour, ignoring case", () => {
		const f = { colors: { High: "red" as const, Low: "green" as const } };
		expect(choiceColor(f, "High")).toBe("red");
		expect(choiceColor(f, "low")).toBe("green");
		expect(choiceColor(f, "Medium")).toBeNull();
		expect(choiceColor(undefined, "High")).toBeNull();
		// Something that isn't a palette colour is ignored.
		expect(choiceColor({ colors: { X: "teal" as never } }, "X")).toBeNull();
		expect(isPaletteColor("grey")).toBe(true);
	});

	it("take a status's colour from the type, then its group", () => {
		const task = { group: "work", statusColors: { blocked: "orange" as const } };
		expect(statusColor("blocked", task, groups)).toBe("orange");
		expect(statusColor("in-progress", task, groups)).toBe("blue");
		expect(statusColor("done", task, groups)).toBeNull();
		expect(statusColor("blocked", { group: "home" }, groups)).toBeNull();
		expect(statusColor("blocked", undefined, groups)).toBeNull();
		expect(statusColorAmong("in-progress", [{ group: "home" }, { group: "work" }], groups)).toBe("blue");
	});

	it("set, clear, prune and rename", () => {
		expect(withColor(undefined, "High", "red")).toEqual({ High: "red" });
		expect(withColor({ High: "red" }, "High", null)).toBeUndefined();
		expect(pruneColors({ High: "red", Gone: "blue" }, ["High", "Low"])).toEqual({ High: "red" });
		expect(pruneColors({ Gone: "blue" }, ["High"])).toBeUndefined();
		expect(renameColor({ todo: "grey", done: "green" }, "done", "finished")).toEqual({ todo: "grey", finished: "green" });
		expect(renameColor({ done: "green" }, "done", "")).toBeUndefined();
		expect(renameColor({ done: "green" }, "other", "x")).toEqual({ done: "green" });
	});
});
