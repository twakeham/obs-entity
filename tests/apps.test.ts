import { describe, expect, it } from "vitest";
import { appContents, appFileName, exportApp, installApp, mergeComponents, type AppConfig } from "../src/model/apps";
import type { SavedComponent } from "../src/model/layoutClipboard";
import { parsePack, STARTER_PACK } from "../src/model/packs";
import { mergeSettings } from "../src/model/settings";
import type { EntityTypeDef, FieldDef, GroupDef } from "../src/model/types";
import { newWorkflow, type WorkflowDef } from "../src/model/workflows";

const f = (key: string, label: string, kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, kind, ...extra });
const type = (key: string, group: string, fields: FieldDef[] = []): EntityTypeDef => ({ key, name: key[0].toUpperCase() + key.slice(1), plural: `${key}s`, icon: "x", color: "#000000", group, template: "", fields, builtIn: false });
const GROUPS: GroupDef[] = [
	{ key: "work", name: "Work", icon: "x", statuses: ["todo", "done"] },
	{ key: "empty", name: "Empty", icon: "x", statuses: ["a"] },
];
const TASK = type("task", "work", [f("project", "Project", "relation", { targets: ["project"] })]);
const PROJECT = type("project", "work");
const comp = (id: string, name: string): SavedComponent => ({ id, name, icon: "package", clip: { node: { kind: "heading", text: name }, fields: [] } });
const wf = (id: string, on: boolean, views?: string[]): WorkflowDef => ({ ...newWorkflow(["task"]), id, name: id, on, ...(views ? { views } : {}) });
const CONFIG: AppConfig = { groups: GROUPS, types: [TASK, PROJECT], workflows: [wf("wf-a", true), wf("wf-b", false)], layoutComponents: [comp("c1", "Header")], deletedPackTypes: [] };
let n = 0;
const newId = () => `new${++n}`;

const exported = () => {
	const text = exportApp(CONFIG, { name: " Tracker ", version: "2.1", author: "", description: "Tasks" }, { views: [{ name: "Tasks", path: "Views/Tasks.md", view: { types: ["task"] } }], templates: { task: "# T" } });
	const parsed = parsePack(text);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.pack;
};

describe("apps", () => {
	it("export everything, every group included, with tidy details", () => {
		const pack = exported();
		expect(pack.app).toEqual({ name: "Tracker", version: "2.1", description: "Tasks" });
		expect(pack.groups?.map((g) => g.key)).toEqual(["work", "empty"]);
		expect(pack.components?.map((c) => c.name)).toEqual(["Header"]);
		expect(appContents(pack)).toEqual({ types: 2, groups: 2, workflows: 2, workflowsOn: 1, views: 1, templates: 1, components: 1 });
	});

	it("name the file from the name and version", () => {
		expect(appFileName({ name: "Tracker", version: "2.1" })).toBe("Tracker 2.1.json");
		expect(appFileName({ name: "A/B: c" })).toBe("A B c.json");
	});

	it("replace: keys and ids as they are, starter types marked deleted, workflows off unless kept on", () => {
		const pack = exported();
		const here: AppConfig = { groups: [{ key: "other", name: "Other", icon: "x", statuses: ["x"] }], types: [type("task", "other"), type("person", "other")], workflows: [wf("wf-a", true)], layoutComponents: [comp("c9", "Mine")], deletedPackTypes: ["note"] };
		const off = installApp(pack, here, "replace", false, newId);
		expect(off.types.map((t) => t.key)).toEqual(["task", "project"]);
		expect(off.renamed).toEqual({});
		expect(off.groups.map((g) => g.key)).toEqual(["work", "empty"]);
		expect(off.allWorkflows.map((w) => [w.id, w.on])).toEqual([["wf-a", false], ["wf-b", false]]);
		expect(off.components.map((c) => c.id)).toEqual(["c1"]);
		expect(new Set(off.deletedPackTypes)).toEqual(new Set(STARTER_PACK.types.map((t) => t.key).filter((k) => k !== "project")));
		const on = installApp(pack, here, "replace", true, newId);
		expect(on.allWorkflows.map((w) => w.on)).toEqual([true, false]);
		// The starter types don't come back when the settings are read again.
		const read = mergeSettings({ groups: on.groups, types: on.types, workflows: on.allWorkflows, deletedPackTypes: on.deletedPackTypes });
		expect(read.types.map((t) => t.key)).toEqual(["task", "project"]);
	});

	it("replace with an app that has no groups keeps a group", () => {
		const res = installApp({ obsEntitiesPack: 1, types: [type("thing", "nowhere")] }, CONFIG, "replace", false, newId);
		expect(res.groups.map((g) => g.key)).toEqual(["entities"]);
		expect(res.types[0].group).toBe("entities");
	});

	it("add: beside the configuration, clashing keys and ids renamed, components merged", () => {
		const pack = exported();
		const res = installApp(pack, CONFIG, "add", false, newId);
		expect(res.renamed).toEqual({ task: "task_2", project: "project_2" });
		expect(res.types.map((t) => t.key)).toEqual(["task", "project", "task_2", "project_2"]);
		expect(res.types[2].fields[0].targets).toEqual(["project_2"]);
		expect(res.allWorkflows.length).toBe(4);
		expect(res.allWorkflows.slice(0, 2).map((w) => w.id)).toEqual(["wf-a", "wf-b"]);
		expect(res.workflows.every((w) => !w.on && !["wf-a", "wf-b"].includes(w.id))).toBe(true);
		// The identical component is already here.
		expect(res.componentsAdded).toBe(0);
		expect(res.components.length).toBe(1);
		expect(res.templates).toEqual({ task_2: "# T" });
		expect(res.views[0].def.types).toEqual(["task_2"]);
	});

	it("merge components: skip identical ones, new ids for taken ones", () => {
		const m = mergeComponents([comp("c1", "Header")], [comp("c1", "Header"), comp("c1", "Footer"), comp("c2", "Side")], () => "cx");
		expect(m.added).toBe(2);
		expect(m.list.map((c) => `${c.id}:${c.name}`)).toEqual(["c1:Header", "cx:Footer", "c2:Side"]);
	});

	it("read app details and components when parsing; reject an app without a name", () => {
		expect(parsePack(JSON.stringify({ types: [TASK], app: { version: "1" } }))).toEqual({ ok: false, error: "The app's details need a name." });
		expect(parsePack(JSON.stringify({ types: [TASK], components: {} }))).toEqual({ ok: false, error: "“components” should be a list." });
		const ok = parsePack(JSON.stringify({ types: [TASK], app: { name: " X ", author: 3 }, components: [comp("c1", "A"), { bad: true }] }));
		expect(ok.ok && ok.pack.app).toEqual({ name: "X" });
		expect(ok.ok && ok.pack.components?.length).toBe(1);
	});

	it("keep the last app details in settings", () => {
		expect(mergeSettings({ appDetails: { name: " T ", version: "1", author: 5 as unknown as string } }).appDetails).toEqual({ name: "T", version: "1" });
		expect(mergeSettings({ appDetails: { name: "" } }).appDetails).toBeUndefined();
	});
});
