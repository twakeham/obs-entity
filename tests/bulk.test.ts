import { describe, expect, it } from "vitest";
import { applyChange, bulkFields, changeApplies, copyName, describeChange, setValueFor, statusUnion } from "../src/model/bulk";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (k: string) => TYPES.find((t) => t.key === k)!;

describe("bulk: shared fields", () => {
	it("lists status, each field key once with the types it applies to, then tags", () => {
		const f = bulkFields([T("person"), T("project")]);
		expect(f[0]).toMatchObject({ key: "status", kind: "status", types: ["person", "project"] });
		expect(f[f.length - 1]).toMatchObject({ key: "tags", kind: "tags", types: ["person", "project"] });
		const keys = f.map((x) => `${x.key}:${x.types.join("+")}`);
		expect(keys).toContain("owner:project");
		expect(keys.filter((k) => k.startsWith("status:")).length).toBe(1);
		// a key both types have, with the same kind, lists both
		const shared = f.find((x) => x.types.length === 2 && x.key !== "status" && x.key !== "tags");
		if (shared) expect(shared.types).toEqual(["person", "project"]);
	});

	it("unions statuses in order", () => {
		expect(statusUnion([T("person"), T("project")], GROUPS)).toEqual([...new Set([...GROUPS.find((g) => g.key === T("person").group)!.statuses, ...GROUPS.find((g) => g.key === T("project").group)!.statuses])]);
	});
});

describe("bulk: applying changes", () => {
	it("sets and clears values, reporting whether anything changed", () => {
		const fm: Record<string, unknown> = { status: "draft", due: "2026-01-01", team: ["[[A]]"] };
		expect(applyChange(fm, { op: "set", key: "status", value: "active" })).toBe(true);
		expect(fm.status).toBe("active");
		expect(applyChange(fm, { op: "set", key: "status", value: "active" })).toBe(false);
		expect(applyChange(fm, { op: "set", key: "due", value: null })).toBe(true);
		expect(fm).toHaveProperty("due", null);
		expect(applyChange(fm, { op: "set", key: "team", value: undefined })).toBe(true);
		expect(fm.team).toEqual([]);
		expect(applyChange(fm, { op: "set", key: "missing", value: null })).toBe(false);
		expect("missing" in fm).toBe(false);
		const v = ["x"];
		applyChange(fm, { op: "set", key: "list", value: v });
		v.push("y");
		expect(fm.list).toEqual(["x"]);
	});

	it("adds and removes links", () => {
		const fm: Record<string, unknown> = { team: ["[[Ada]]"], owner: "[[Ada]]" };
		expect(applyChange(fm, { op: "add-link", key: "team", linktext: "Grace", multiple: true, labelled: false })).toBe(true);
		expect(fm.team).toEqual(["[[Ada]]", "[[Grace]]"]);
		expect(applyChange(fm, { op: "add-link", key: "team", linktext: "grace", multiple: true, labelled: false })).toBe(false);
		expect(applyChange(fm, { op: "add-link", key: "owner", linktext: "Grace", multiple: false, labelled: false })).toBe(true);
		expect(fm.owner).toBe("[[Grace]]");
		expect(applyChange(fm, { op: "remove-link", key: "team", matches: (p) => p === "Ada" })).toBe(true);
		expect(fm.team).toEqual(["[[Grace]]"]);
		expect(applyChange(fm, { op: "remove-link", key: "team", matches: (p) => p === "Nobody" })).toBe(false);
		expect(applyChange(fm, { op: "remove-link", key: "absent", matches: () => true })).toBe(false);
	});

	it("adds and removes tags, ignoring # and case", () => {
		const fm: Record<string, unknown> = { tags: ["work", "Urgent"] };
		expect(applyChange(fm, { op: "add-tags", tags: ["#urgent", "new", "NEW"] })).toBe(true);
		expect(fm.tags).toEqual(["work", "Urgent", "new"]);
		expect(applyChange(fm, { op: "add-tags", tags: ["work"] })).toBe(false);
		expect(applyChange(fm, { op: "remove-tags", tags: ["URGENT", "#new"] })).toBe(true);
		expect(fm.tags).toEqual(["work"]);
		const empty: Record<string, unknown> = {};
		expect(applyChange(empty, { op: "add-tags", tags: ["a"] })).toBe(true);
		expect(empty.tags).toEqual(["a"]);
	});

	it("knows which entities a change applies to", () => {
		const person = T("person");
		const project = T("project");
		const firstProjectStatus = statusUnion([project], GROUPS)[0];
		expect(changeApplies({ op: "set", key: "owner", value: "x" }, project, GROUPS)).toBe(true);
		expect(changeApplies({ op: "set", key: "owner", value: "x" }, person, GROUPS)).toBe(false);
		expect(changeApplies({ op: "set", key: "status", value: firstProjectStatus }, project, GROUPS)).toBe(true);
		expect(changeApplies({ op: "set", key: "status", value: "not-a-status" }, project, GROUPS)).toBe(false);
		expect(changeApplies({ op: "set", key: "status", value: null }, person, GROUPS)).toBe(true);
		expect(changeApplies({ op: "add-tags", tags: ["x"] }, person, GROUPS)).toBe(true);
		expect(changeApplies({ op: "add-link", key: "team", linktext: "A", multiple: true, labelled: false }, project, GROUPS)).toBe(true);
	});

	it("normalises set values by kind, describes changes and names copies", () => {
		const f = bulkFields([T("project")]);
		const team = f.find((x) => x.key === "team")!;
		const owner = f.find((x) => x.key === "owner")!;
		expect(setValueFor(team, "[[A]]")).toEqual(["[[A]]"]);
		expect(setValueFor(owner, ["[[A]]", "[[B]]"])).toBe("[[A]]");
		expect(setValueFor(f.find((x) => x.key === "tags")!, "x")).toEqual(["x"]);
		expect(setValueFor(owner, "")).toBeNull();
		expect(describeChange({ op: "set", key: "status", value: "done" }, "Status", "done", 12)).toBe("Set Status to “done” on 12 entities");
		expect(describeChange({ op: "set", key: "due", value: null }, "Due", "", 1)).toBe("Cleared Due on 1 entity");
		expect(describeChange({ op: "add-tags", tags: ["urgent", "#x"] }, "", "", 3)).toBe("Added #urgent, #x to 3 entities");
		expect(describeChange({ op: "remove-link", key: "team", matches: () => true }, "Team", "Ada", 2)).toBe("Removed Ada from Team on 2 entities");
		expect(copyName("Plan", new Set())).toBe("Plan (copy)");
		expect(copyName("Plan", new Set(["plan (copy)", "plan (copy 2)"]))).toBe("Plan (copy 3)");
	});
});
