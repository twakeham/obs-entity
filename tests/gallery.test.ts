import { describe, expect, it } from "vitest";
import { GALLERY } from "../src/model/gallery";
import { installPack, parsePack, type InstallResult } from "../src/model/packs";
import type { EntityTypeDef, GroupDef } from "../src/model/types";
import { typeIssues } from "../src/model/validation";
import { BUILTINS, isGroup, parseView, type ColumnDef, type FilterGroup, type ViewDef } from "../src/model/views";
import { workflowProblems } from "../src/model/workflows";

/** Problems with an installed pack: its types', its views' (unknown fields) and its workflows'. */
function problems(res: InstallResult): string[] {
	const out: string[] = [];
	const ctx = { typeKeys: res.types.map((t) => t.key), groupKeys: res.groups.map((g) => g.key), types: res.types, groups: res.groups };
	for (const t of res.types) for (const i of typeIssues(t, ctx)) out.push(`type ${t.key}: ${i.at} ${i.message}`);
	for (const v of res.views) for (const p of viewProblems(v.def, res.types)) out.push(`view ${v.name}: ${p}`);
	for (const w of res.workflows) for (const p of workflowProblems(w, { types: res.types, groups: res.groups, workflows: res.workflows })) out.push(`workflow ${w.name}: ${p.at} ${p.message}`);
	return out;
}

/** Ids a view uses that aren't columns its types can have (built-ins, their fields, its own roll-ups and formulas, links from other types). */
function viewProblems(def: ViewDef, types: EntityTypeDef[]): string[] {
	const shown = types.filter((t) => def.types.some((x) => x === "*" || x === t.key || x === `@${t.group}`));
	if (!shown.length) return [`shows no type (${def.types.join(", ")})`];
	const known = new Set<string>([...BUILTINS, ...shown.flatMap((t) => t.fields.map((f) => f.key)), ...def.columns.filter((c) => c.kind === "rollup" || c.kind === "formula").map((c) => c.id)]);
	const ok = (id: string) => {
		if (known.has(id)) return true;
		const m = /^in:([^.]+)\.(.+)$/.exec(id);
		return !!m && !!types.find((t) => t.key === m[1])?.fields.some((f) => f.key === m[2]);
	};
	const ids = (g: FilterGroup): string[] => g.items.flatMap((i) => (isGroup(i) ? ids(i) : [i.field]));
	const used = [
		...def.columns.filter((c: ColumnDef) => c.kind !== "rollup" && c.kind !== "formula").map((c) => c.id),
		...def.columns.flatMap((c) => (c.kind === "rollup" ? [c.rollup.via] : [])).filter((v) => v.startsWith("in:")),
		...def.sort.map((s) => s.by),
		...def.group.map((g) => g.by),
		...ids(def.filters),
		...def.highlight.flatMap((h) => [h.target, ...ids(h.when)]).filter((x) => x !== "row"),
		...(def.board?.cardFields ?? []),
		...(def.board?.buckets ? [def.board.buckets] : []),
		...Object.values(def.calendar?.dates ?? {}).flatMap((d) => (d ? [d.start, ...(d.end ? [d.end] : [])] : [])),
	];
	return [...new Set(used.filter((id) => !ok(id)))].map((id) => `unknown column ${id}`);
}

describe("the pack gallery", () => {
	for (const pack of GALLERY)
		it(`${pack.name}: reads, installs, and its types, views and workflows have no problems`, () => {
			expect(pack.description).toBeTruthy();
			expect(pack.icon).toBeTruthy();
			const parsed = parsePack(JSON.stringify(pack));
			expect(parsed.ok).toBe(true);
			for (const v of pack.views ?? []) expect(parseView(v.view).errors, v.name).toEqual([]);
			const res = installPack(pack, [], [], []);
			expect(res.renamed).toEqual({});
			expect(problems(res)).toEqual([]);
			expect(res.views.length).toBe(pack.views?.length ?? 0);
		});

	it("every pack together: shared types (person, author, topic) once, the rest numbered, no problems", () => {
		let groups: GroupDef[] = [];
		let types: EntityTypeDef[] = [];
		const all: InstallResult[] = [];
		for (const pack of GALLERY) {
			const res = installPack(pack, groups, types, all.flatMap((r) => r.workflows));
			groups = res.groups;
			types = res.types;
			all.push(res);
		}
		const keys = types.map((t) => t.key);
		for (const k of ["person", "author", "topic"]) expect(keys.filter((x) => x === k || x.startsWith(`${k}_`))).toEqual([k]);
		// Starter's and Project delivery's projects are different types.
		expect(keys).toContain("project_2");
		const ctx = { typeKeys: keys, groupKeys: groups.map((g) => g.key), types, groups };
		expect(types.flatMap((t) => typeIssues(t, ctx).map((i) => `${t.key}: ${i.message}`))).toEqual([]);
		// One type per search shortcut.
		const shortcuts = types.flatMap((t) => t.shortcuts ?? []);
		expect(shortcuts.length).toBe(new Set(shortcuts).size);
		// No group only for a type that was reused.
		expect(groups.filter((g) => !types.some((t) => t.group === g.key)).map((g) => g.key)).toEqual([]);
	});
});
