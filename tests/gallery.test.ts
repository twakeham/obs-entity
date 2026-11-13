import { describe, expect, it } from "vitest";
import { GALLERY } from "../src/model/gallery";
import { dashboardTypes, installPack, parsePack, renameDashboardKeys, renameDashboardViews, type InstallResult } from "../src/model/packs";
import { isDashboardRaw, parseDashboard, type DashboardDef } from "../src/model/dashboard";
import type { EntityTypeDef, GroupDef } from "../src/model/types";
import { typeIssues } from "../src/model/validation";
import { BUILTINS, emptyView, isGroup, parseView, type ColumnDef, type FilterGroup, type ViewDef } from "../src/model/views";
import { inScope, onNotes, workflowProblems } from "../src/model/workflows";
import { nodeKeys, placeableKeys } from "../src/model/formLayout";

/** Problems with an installed pack: its types', its views' (unknown fields) and its workflows'. */
function problems(res: InstallResult): string[] {
	const out: string[] = [];
	const ctx = { typeKeys: res.types.map((t) => t.key), groupKeys: res.groups.map((g) => g.key), types: res.types, groups: res.groups };
	for (const t of res.types) for (const i of typeIssues(t, ctx)) out.push(`type ${t.key}: ${i.at} ${i.message}`);
	// Layouts place only what the type can: its fields, built-ins, note items, and buttons of its button workflows.
	for (const t of res.types) {
		const buttons = res.workflows.filter((w) => onNotes(w) && inScope(w, t)).map((w) => w.id);
		const ok = new Set(placeableKeys(t, buttons));
		for (const k of nodeKeys(t.form?.layout?.items ?? [])) if (!ok.has(k)) out.push(`type ${t.key}: layout places ${k}`);
	}
	for (const v of res.views) for (const p of viewProblems(v.def, res.types)) out.push(`view ${v.name}: ${p}`);
	for (const d of res.dashboards) for (const p of dashboardProblems(d.def, res)) out.push(`dashboard ${d.name}: ${p}`);
	for (const w of res.workflows) for (const p of workflowProblems(w, { types: res.types, groups: res.groups, workflows: res.workflows })) out.push(`workflow ${w.name}: ${p.at} ${p.message}`);
	return out;
}

/** Ids a view uses that aren't columns its types can have (built-ins, their fields, its own roll-ups and formulas, links from other types). */
function viewProblems(def: ViewDef, types: EntityTypeDef[]): string[] {
	const shown = types.filter((t) => def.types.some((x) => x === "*" || x === t.key || x === `@${t.group}`));
	if (!shown.length) return [`shows no type (${def.types.join(", ")})`];
	if (def.kind === "board" && !def.board?.buckets) return ["a board without buckets"];
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

/**
 * Problems with a dashboard: each Types source as a view of the columns, sort and row rules its component uses;
 * filters' types and fields; buttons' types and workflows.
 */
function dashboardProblems(def: DashboardDef, res: InstallResult): string[] {
	const out: string[] = [];
	const typeOk = (t: string) => res.types.some((x) => x.key === t) || (t.startsWith("@") && res.groups.some((g) => `@${g.key}` === t));
	for (const c of def.components) {
		const where = c.title || c.id;
		if ("source" in c && c.source?.kind === "query") {
			const columns: ColumnDef[] = c.kind === "card" && "agg" in c.value && c.value.column ? [c.value.column] : c.kind === "chart" ? [c.by, c.split, c.measure.column].filter((x): x is ColumnDef => !!x) : c.kind === "list" ? c.fields : [];
			const view: ViewDef = { ...c.source.def, columns, sort: c.kind === "list" ? c.sort : c.source.def.sort, highlight: c.kind === "list" ? (c.highlight ?? []) : [], filters: c.kind === "chart" && c.done ? { mode: "all", items: [c.source.def.filters, c.done] } : c.source.def.filters };
			for (const p of viewProblems(view, res.types)) out.push(`${where}: ${p}`);
		}
		if (c.kind === "filter") {
			for (const t of c.types ?? []) if (!typeOk(t)) out.push(`${where}: unknown type ${t}`);
			if (c.field) for (const p of viewProblems({ ...emptyView(), types: c.types?.length ? c.types : ["*"], columns: [c.field] }, res.types)) out.push(`${where}: ${p}`);
		}
		if (c.kind === "button" && c.action) {
			if ("new" in c.action && !typeOk(c.action.new)) out.push(`${where}: unknown type ${c.action.new}`);
			if ("workflow" in c.action && !res.workflows.some((w) => w.id === (c.action as { workflow: string }).workflow)) out.push(`${where}: unknown workflow ${c.action.workflow}`);
		}
	}
	if (def.place && def.place !== "views" && !typeOk(def.place)) out.push(`placed under unknown ${def.place}`);
	return out;
}

describe("the pack gallery", () => {
	for (const pack of GALLERY)
		it(`${pack.name}: reads, installs, and its types, views and workflows have no problems`, () => {
			expect(pack.description).toBeTruthy();
			expect(pack.icon).toBeTruthy();
			const parsed = parsePack(JSON.stringify(pack));
			expect(parsed.ok).toBe(true);
			for (const v of pack.views ?? []) expect(isDashboardRaw(v.view) ? parseDashboard(v.view).errors : parseView(v.view).errors, v.name).toEqual([]);
			const res = installPack(pack, [], [], []);
			expect(res.renamed).toEqual({});
			expect(problems(res)).toEqual([]);
			expect(res.views.length + res.dashboards.length).toBe(pack.views?.length ?? 0);
		});

	it("TTRPG: its campaign dashboard follows renamed types and workflows when they clash", () => {
		const ttrpg = GALLERY.find((p) => p.id === "ttrpg")!;
		const first = installPack(ttrpg, [], [], []);
		const again = installPack(ttrpg, first.groups, first.types, first.workflows);
		const d = again.dashboards.find((x) => x.name === "Campaign dashboard")!.def;
		expect(again.renamed).toMatchObject({ campaign: "campaign_2", quest: "quest_2" });
		expect(d.place).toBe("campaign_2");
		const byId = (id: string) => d.components.find((c) => c.id === id)!;
		expect(byId("camp")).toMatchObject({ types: ["campaign_2"] });
		expect(byId("open")).toMatchObject({ source: { kind: "query", def: { types: ["quest_2"] } } });
		const log = byId("log");
		expect(log.kind === "button" && log.action && "workflow" in log.action && log.action.workflow).not.toBe("wf-tt-log-session");
		expect(again.workflows.some((w) => log.kind === "button" && log.action && "workflow" in log.action && w.id === log.action.workflow)).toBe(true);
		expect(dashboardProblems(d, again)).toEqual([]);
	});

	it("rename a dashboard's view sources and notes() calls, and say which types it shows", () => {
		const { def } = parseDashboard({
			kind: "dashboard",
			components: [
				{ id: "a", kind: "card", source: { view: "Quest board" }, value: { agg: "count" } },
				{ id: "b", kind: "view", view: "Quest board" },
				{ id: "c", kind: "card", value: { formula: 'count(notes("quest")) + count(notes("npc"))' } },
			],
		});
		const moved = renameDashboardViews(def, new Map([["Quest board", "Quest board 2"]]));
		expect(moved.components.slice(0, 2)).toMatchObject([{ source: { view: "Quest board 2" } }, { view: "Quest board 2" }]);
		const renamed = renameDashboardKeys(def, new Map([["quest", "quest_2"]]));
		expect(renamed.components[2]).toMatchObject({ value: { formula: 'count(notes("quest_2")) + count(notes("npc"))' } });
		expect(dashboardTypes(def)).toEqual(["*"]);
		expect(dashboardTypes(parseDashboard({ kind: "dashboard", components: [{ id: "a", kind: "card", source: { types: ["quest"] }, value: { agg: "count" } }, { id: "f", kind: "filter", control: "note", types: ["campaign"] }] }).def)).toEqual(["quest", "campaign"]);
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
