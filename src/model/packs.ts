import { FIELD_KINDS, cloneGroup, cloneType, isValidKey, type EntityTypeDef, type GroupDef } from "./types";
import { rewriteRefs } from "./formula";
import { isGroup, parseView, type ColumnDef, type FilterGroup, type GroupBy, type ViewDef } from "./views";
import { cloneWorkflow, flatSteps, mapStepTexts, mapTemplate, newWorkflowId, readWorkflows, scopeTypes, type WorkflowDef, type WorkflowStep } from "./workflows";
import { normaliseLayout, renameLayoutKey, workflowItem } from "./formLayout";
import { readComponents, type SavedComponent } from "./layoutClipboard";

/** A shareable bundle of types (and the groups they use), and workflows. */
export interface TypePack {
	obsEntitiesPack: 1;
	id?: string;
	name?: string;
	groups?: GroupDef[];
	types: EntityTypeDef[];
	/** workflows for these types (imported switched off) */
	workflows?: WorkflowDef[];
	/** view notes: their names, their paths where they came from (workflows' view lists name them), and their definitions */
	views?: PackView[];
	/** type key → the text of its note template */
	templates?: Record<string, string>;
	/** a whole configuration exported as an app: its details */
	app?: AppDetails;
	/** saved layout components ("My components") */
	components?: SavedComponent[];
}

/** What an exported app says about itself. */
export interface AppDetails {
	name: string;
	description?: string;
	author?: string;
	version?: string;
}

/** A view note in a pack. `view` is the definition as written in the note's block. */
export interface PackView {
	name: string;
	path?: string;
	view: Record<string, unknown>;
}

export const STARTER_PACK: TypePack = {
	obsEntitiesPack: 1,
	id: "starter",
	name: "Starter",
	groups: [
		{ key: "directory", name: "Directory", icon: "book-user", statuses: ["draft", "active", "archived"] },
		{ key: "work", name: "Work", icon: "briefcase", statuses: ["idea", "active", "on-hold", "done"] },
	],
	types: [
		{
			key: "person",
			name: "Person",
			plural: "People",
			icon: "user",
			color: "#2196f3",
			group: "directory",
			template: "Person.md",
			shortcuts: ["p"],
			sections: ["Overview", "Background", "Conversations", "Notes"],
			card: { subtitle: ["role"] },
			fields: [
				{ key: "role", label: "Role", kind: "text", inModal: true },
				{ key: "works_for", label: "Works for", kind: "relation", targets: ["organisation"], inverse: "People", inModal: true },
				{ key: "based_in", label: "Based in", kind: "relation", targets: ["place"], inverse: "People based here" },
				{ key: "email", label: "Email", kind: "url" },
				{ key: "phone", label: "Phone", kind: "text" },
				{ key: "birthday", label: "Birthday", kind: "date" },
				{ key: "knows", label: "Knows", kind: "relation", targets: ["person"], multiple: true, labelled: true, inverse: "Known by" },
			],
			builtIn: true,
		},
		{
			key: "organisation",
			name: "Organisation",
			plural: "Organisations",
			icon: "building-2",
			color: "#3f51b5",
			group: "directory",
			template: "Organisation.md",
			shortcuts: ["org"],
			sections: ["Overview", "People", "History", "Notes"],
			parentFields: ["part_of"],
			card: { subtitle: ["kind"] },
			fields: [
				{ key: "kind", label: "Kind", kind: "select", options: ["Company", "Non-profit", "Government", "Community", "Other"], inModal: true },
				{ key: "website", label: "Website", kind: "url", inModal: true },
				{ key: "located_in", label: "Located in", kind: "relation", targets: ["place"], inverse: "Organisations" },
				{ key: "part_of", label: "Part of", kind: "relation", targets: ["organisation"], inverse: "Divisions" },
			],
			builtIn: true,
		},
		{
			key: "place",
			name: "Place",
			plural: "Places",
			icon: "map-pin",
			color: "#4caf50",
			group: "directory",
			template: "Place.md",
			shortcuts: ["loc"],
			sections: ["Overview", "Getting there", "Notes"],
			parentFields: ["part_of"],
			card: { subtitle: ["kind", "address"] },
			fields: [
				{ key: "kind", label: "Kind", kind: "select", options: ["Country", "Region", "City", "Venue", "Building", "Room", "Other"], inModal: true },
				{ key: "part_of", label: "Part of", kind: "relation", targets: ["place"], inverse: "Contains", inModal: true },
				{ key: "address", label: "Address", kind: "textarea" },
			],
			builtIn: true,
		},
		{
			key: "project",
			name: "Project",
			plural: "Projects",
			icon: "folder-kanban",
			color: "#ff9800",
			group: "work",
			folderMode: "own",
			template: "Project.md",
			shortcuts: ["proj"],
			sections: ["Goal", "Scope", "Plan", "Decisions", "Risks", "Notes"],
			parentFields: ["parent_project"],
			card: { subtitle: ["description"] },
			fields: [
				{ key: "description", label: "Description", kind: "textarea", inModal: true },
				{ key: "owner", label: "Owner", kind: "relation", targets: ["person"], inverse: "Owns projects", inModal: true },
				{ key: "team", label: "Team", kind: "relation", targets: ["person"], multiple: true, inverse: "Projects" },
				{ key: "client", label: "Client", kind: "relation", targets: ["organisation"], inverse: "Projects" },
				{ key: "start", label: "Start", kind: "date" },
				{ key: "due", label: "Due", kind: "date", inModal: true },
				{ key: "parent_project", label: "Parent project", kind: "relation", targets: ["project"], inverse: "Sub-projects" },
			],
			builtIn: true,
		},
		{
			key: "note",
			name: "Note",
			plural: "Notes",
			icon: "sticky-note",
			color: "#9e9e9e",
			group: "work",
			folderMode: "parent",
			template: "Note.md",
			shortcuts: ["n"],
			sections: ["Notes", "Actions"],
			parentFields: ["project"],
			card: { subtitle: ["noted_on"] },
			fields: [
				{ key: "project", label: "Project", kind: "relation", targets: ["project"], inverse: "Notes", inModal: true },
				{ key: "noted_on", label: "Date", kind: "date", inModal: true },
				{ key: "about", label: "About", kind: "relation", targets: ["*"], multiple: true, inverse: "Notes about this", inModal: true },
			],
			builtIn: true,
		},
	],
};

/** Example pack from the design doc, for trying imports. */
export const CRM_PACK: TypePack = {
	obsEntitiesPack: 1,
	id: "crm-basic",
	name: "Basic CRM",
	groups: [
		{ key: "people", name: "People", icon: "users", statuses: ["lead", "active", "inactive"] },
		{ key: "orgs", name: "Organisations", icon: "building-2", statuses: ["prospect", "customer", "former"] },
		{ key: "sales", name: "Sales", icon: "briefcase", statuses: ["open", "won", "lost"] },
	],
	types: [
		{
			key: "contact",
			name: "Contact",
			plural: "Contacts",
			icon: "contact",
			color: "#03a9f4",
			group: "people",
			template: "Contact.md",
			shortcuts: ["c"],
			card: { subtitle: ["role", "email"] },
			fields: [
				{ key: "role", label: "Role", kind: "text", inModal: true },
				{ key: "email", label: "Email", kind: "url", inModal: true },
				{ key: "works_at", label: "Works at", kind: "relation", targets: ["company"], inverse: "Contacts", inModal: true },
				{ key: "knows", label: "Knows", kind: "relation", targets: ["contact"], multiple: true, labelled: true, inverse: "Known by" },
			],
			builtIn: false,
		},
		{
			key: "company",
			name: "Company",
			plural: "Companies",
			icon: "factory",
			color: "#673ab7",
			group: "orgs",
			template: "Company.md",
			parentFields: ["subsidiary_of"],
			card: { subtitle: ["industry"] },
			fields: [
				{ key: "industry", label: "Industry", kind: "select", options: ["Software", "Finance", "Retail", "Other"], inModal: true },
				{ key: "website", label: "Website", kind: "url" },
				{ key: "subsidiary_of", label: "Subsidiary of", kind: "relation", targets: ["company"], inverse: "Subsidiaries" },
			],
			builtIn: false,
		},
		{
			key: "deal",
			name: "Deal",
			plural: "Deals",
			icon: "handshake",
			color: "#8bc34a",
			group: "sales",
			template: "Deal.md",
			card: { subtitle: ["description"] },
			fields: [
				{ key: "description", label: "Description", kind: "textarea", inModal: true },
				{ key: "company", label: "Company", kind: "relation", targets: ["company"], inverse: "Deals", required: true, inModal: true },
				{ key: "value", label: "Value", kind: "number", inModal: true },
				{ key: "close_date", label: "Close date", kind: "date", inModal: true },
				{ key: "contacts", label: "Contacts", kind: "relation", targets: ["contact"], multiple: true, labelled: true, inverse: "Deals" },
			],
			builtIn: false,
		},
	],
};

export type PackParse = { ok: true; pack: TypePack } | { ok: false; error: string };

/**
 * Read a pack from JSON text. Accepts the pack form, a single type object, or a bare list of types.
 * Checks shape only (names, fields, kinds); keys are checked when installing.
 */
export function parsePack(text: string): PackParse {
	if (!text.trim()) return { ok: false, error: "Paste a type pack (JSON) first." };
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (e) {
		return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
	}
	let types: unknown[];
	let groups: unknown[] = [];
	let workflows: unknown[] = [];
	let views: unknown[] = [];
	let templates: Record<string, string> = {};
	let app: AppDetails | undefined;
	let components: SavedComponent[] = [];
	let meta: Record<string, unknown> = {};
	if (Array.isArray(data)) types = data;
	else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).types)) {
		meta = data as Record<string, unknown>;
		types = meta.types as unknown[];
		groups = Array.isArray(meta.groups) ? (meta.groups as unknown[]) : [];
		if (meta.workflows !== undefined && !Array.isArray(meta.workflows)) return { ok: false, error: "“workflows” should be a list." };
		workflows = Array.isArray(meta.workflows) ? (meta.workflows as unknown[]) : [];
		if (meta.views !== undefined && !Array.isArray(meta.views)) return { ok: false, error: "“views” should be a list." };
		views = Array.isArray(meta.views) ? (meta.views as unknown[]) : [];
		if (meta.templates !== undefined) {
			const t = meta.templates;
			if (!t || typeof t !== "object" || Array.isArray(t) || Object.values(t).some((v) => typeof v !== "string")) return { ok: false, error: "“templates” should map type keys to template text." };
			templates = { ...(t as Record<string, string>) };
		}
		if (meta.components !== undefined && !Array.isArray(meta.components)) return { ok: false, error: "“components” should be a list." };
		if (meta.app !== undefined) {
			const a = meta.app as Record<string, unknown> | null;
			if (!a || typeof a !== "object" || typeof a.name !== "string" || !a.name.trim()) return { ok: false, error: "The app's details need a name." };
			app = { name: a.name.trim(), ...Object.fromEntries((["description", "author", "version"] as const).filter((k) => typeof a[k] === "string" && (a[k] as string).trim()).map((k) => [k, (a[k] as string).trim()])) };
		}
		components = readComponents(meta.components);
	} else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).fields)) types = [data];
	else return { ok: false, error: "Expected a pack ({ types: [...] }), a type, or a list of types." };
	if (types.length === 0 && workflows.length === 0 && views.length === 0) return { ok: false, error: "The pack has no types." };
	for (const [i, raw] of workflows.entries()) {
		const w = raw as { name?: unknown; steps?: unknown };
		if (!w || typeof w !== "object" || !Array.isArray(w.steps)) return { ok: false, error: `Workflow ${typeof w?.name === "string" ? `“${w.name}”` : `#${i + 1}`} has no steps list.` };
	}
	for (const [i, raw] of views.entries()) {
		const v = raw as Partial<PackView>;
		const where = typeof v?.name === "string" && v.name.trim() ? `“${v.name}”` : `#${i + 1}`;
		if (!v || typeof v !== "object" || typeof v.name !== "string" || !v.name.trim()) return { ok: false, error: `View ${where} has no name.` };
		if (!v.view || typeof v.view !== "object" || Array.isArray(v.view)) return { ok: false, error: `View ${where} has no definition.` };
		const read = parseView(v.view);
		if (!read.def) return { ok: false, error: `View ${where}: ${read.errors[0] ?? "its definition can't be read."}` };
	}

	for (const [i, raw] of types.entries()) {
		const t = raw as Partial<EntityTypeDef>;
		const where = typeof t?.name === "string" && t.name ? `"${t.name}"` : `#${i + 1}`;
		if (!t || typeof t !== "object") return { ok: false, error: `Type ${where} isn't an object.` };
		if (typeof t.name !== "string" || !t.name.trim()) return { ok: false, error: `Type ${where} has no name.` };
		if (!Array.isArray(t.fields)) return { ok: false, error: `Type ${where} has no field list.` };
		for (const f of t.fields) {
			if (!f || typeof f.label !== "string" || typeof f.key !== "string") return { ok: false, error: `Type ${where} has a field without a key or label.` };
			if (!FIELD_KINDS.includes(f.kind)) return { ok: false, error: `Field "${f.key}" of ${where} has an unknown kind "${String(f.kind)}".` };
		}
	}
	for (const raw of groups) {
		const g = raw as Partial<GroupDef>;
		if (!g || typeof g.key !== "string" || !isValidKey(g.key) || typeof g.name !== "string") {
			return { ok: false, error: "A group needs a valid key and a name." };
		}
	}
	return {
		ok: true,
		pack: {
			obsEntitiesPack: 1,
			id: typeof meta.id === "string" ? meta.id : undefined,
			name: typeof meta.name === "string" ? meta.name : undefined,
			groups: groups as GroupDef[],
			types: types as EntityTypeDef[],
			...(workflows.length ? { workflows: workflows as WorkflowDef[] } : {}),
			...(views.length ? { views: views as PackView[] } : {}),
			...(Object.keys(templates).length ? { templates } : {}),
			...(app ? { app } : {}),
			...(components.length ? { components } : {}),
		},
	};
}

export interface InstallResult {
	groups: GroupDef[];
	types: EntityTypeDef[];
	/** types added, by final key */
	added: string[];
	/** keys that clashed: original → new */
	renamed: Record<string, string>;
	/** groups added */
	addedGroups: string[];
	/** the pack's workflows, ready to add: off, with ids of their own and the renamed keys */
	workflows: WorkflowDef[];
	/** the pack's views, with the renamed keys, to write as view notes (`path`: where they came from) */
	views: { name: string; path?: string; def: ViewDef }[];
	/** the added types' templates, by their key here */
	templates: Record<string, string>;
}

function uniqueKey(key: string, taken: Set<string>): string {
	if (!taken.has(key)) return key;
	let n = 2;
	while (taken.has(`${key}_${n}`)) n++;
	return `${key}_${n}`;
}

/**
 * Add a pack's types (and missing groups) to existing ones, and its workflows. Clashing type keys get a numbered
 * suffix, and every reference to them in the pack follows (relation targets, roll-ups, formulas, workflows' scopes and
 * steps). Types whose group is unknown go into the first group. Workflows come in switched off (`keepOn`: as exported), with new ids when
 * theirs are taken ("Run another workflow" steps follow).
 */
export function installPack(pack: TypePack, groups: GroupDef[], types: EntityTypeDef[], workflows: WorkflowDef[] = [], opts: { keepOn?: boolean } = {}): InstallResult {
	const outGroups = groups.map(cloneGroup);
	const groupKeys = new Set(outGroups.map((g) => g.key));
	const addedGroups: string[] = [];
	for (const g of pack.groups ?? []) {
		if (groupKeys.has(g.key)) continue;
		outGroups.push({ ...cloneGroup(g), icon: g.icon || "folder", statuses: Array.isArray(g.statuses) && g.statuses.length ? [...g.statuses] : ["draft", "active", "done"] });
		groupKeys.add(g.key);
		addedGroups.push(g.key);
	}
	const fallbackGroup = outGroups[0]?.key ?? "";

	const taken = new Set(types.map((t) => t.key));
	const renamed: Record<string, string> = {};
	// Every name the pack's types go by (as written, and as read when that wasn't a valid key) → their key here.
	const keyMap = new Map<string, string>();
	const incoming = pack.types.map((raw) => {
		const t = cloneType(raw);
		const original = t.key && isValidKey(t.key) ? t.key : nameToKey(t.name);
		const key = uniqueKey(original, taken);
		taken.add(key);
		if (key !== t.key) renamed[t.key || t.name] = key;
		if (t.key) keyMap.set(t.key, key);
		keyMap.set(original, key);
		t.key = key;
		return t;
	});
	for (const [from, to] of [...keyMap]) if (from === to) keyMap.delete(from);
	const added: string[] = [];
	const outTypes = types.map(cloneType);
	for (const t of incoming) {
		t.plural = t.plural || `${t.name}s`;
		t.icon = t.icon || "file";
		t.color = t.color || "#9e9e9e";
		t.template = t.template || `${t.name}.md`;
		if (!groupKeys.has(t.group)) t.group = fallbackGroup;
		t.builtIn = false;
		if (pack.id) t.pack = pack.id;
		renameTypeKeys(t, keyMap);
		outTypes.push(t);
		added.push(t.key);
	}

	// Workflows: tidied as saved ones are, off, with ids of their own here.
	const ids = new Set(workflows.map((w) => w.id));
	const idMap = new Map<string, string>();
	const read = readWorkflows(pack.workflows ?? [], outTypes);
	read.forEach((w, i) => {
		const raw = (pack.workflows ?? [])[i] as { id?: unknown } | undefined;
		let id = w.id;
		while (ids.has(id)) id = newWorkflowId();
		ids.add(id);
		if (typeof raw?.id === "string" && raw.id !== id) idMap.set(raw.id, id);
		w.id = id;
	});
	const outWorkflows = read.map((w) => ({ ...renameWorkflowKeys(w, keyMap, idMap), on: opts.keepOn ? w.on : false }));
	// The new types' forms place buttons of the pack's workflows: they follow those that got new ids.
	if (idMap.size)
		for (const t of outTypes.filter((x) => added.includes(x.key))) {
			let layout = t.form?.layout ? normaliseLayout(t.form.layout) : null;
			if (!layout) continue;
			for (const [from, to] of idMap) layout = renameLayoutKey(layout, workflowItem(from), workflowItem(to));
			t.form = { ...t.form, layout };
		}
	const outViews = (pack.views ?? []).flatMap((v) => {
		const def = parseView(v.view).def;
		return def ? [{ name: v.name.trim(), ...(v.path ? { path: v.path } : {}), def: renameViewKeys(def, keyMap) }] : [];
	});
	const templates: Record<string, string> = {};
	for (const [k, text] of Object.entries(pack.templates ?? {})) {
		const key = keyMap.get(k) ?? k;
		if (added.includes(key)) templates[key] = text;
	}
	return { groups: outGroups, types: outTypes, added, renamed, addedGroups, workflows: outWorkflows, views: outViews, templates };
}

// ---------------------------------------------------------------- renamed keys

/** A column id with a renamed type in it ("in:<type>.<field>": links from that type); other ids stay. */
export function renameColumnId(id: string, keys: Map<string, string>): string {
	const m = /^in:([^.]+)\.(.+)$/.exec(id);
	return m && keys.has(m[1]) ? `in:${keys.get(m[1])}.${m[2]}` : id;
}

/** A formula's references to renamed types' columns, renamed (the rest as written). */
export function renameFormula(src: string, keys: Map<string, string>): string {
	if (!keys.size || !src) return src;
	return rewriteRefs(src, (n) => {
		const to = renameColumnId(n, keys);
		return to === n ? undefined : to;
	});
}

/** A template's {formula} parts with their references renamed (unchanged when none are). */
function renameTemplate(src: string, keys: Map<string, string>): string {
	if (!keys.size) return src;
	return mapTemplate(src, (f) => renameFormula(f, keys));
}

function renameFilter(g: FilterGroup, keys: Map<string, string>): FilterGroup {
	return { ...g, items: g.items.map((x) => (isGroup(x) ? renameFilter(x, keys) : { ...x, field: renameColumnId(x.field, keys) })) };
}

const renameTarget = (x: string, keys: Map<string, string>) => keys.get(x) ?? x;

/** References to renamed types in a type: relation targets, roll-ups (through links from them, and their filters), formulas. */
export function renameTypeKeys(t: EntityTypeDef, keys: Map<string, string>): void {
	if (!keys.size) return;
	for (const f of t.fields) {
		if (f.kind === "relation" && f.targets) f.targets = f.targets.map((x) => renameTarget(x, keys));
		if (f.rollup) f.rollup = { ...f.rollup, via: renameColumnId(f.rollup.via, keys), ...(f.rollup.where ? { where: renameFilter(f.rollup.where, keys) } : {}) };
		if (f.formula) f.formula = renameFormula(f.formula, keys);
	}
}

/** References to renamed types and workflows in a workflow: its scope, Only if, every step's types, filters, formulas and texts. */
export function renameWorkflowKeys(wf: WorkflowDef, keys: Map<string, string>, ids: Map<string, string> = new Map()): WorkflowDef {
	const f = (src: string) => renameFormula(src, keys);
	const tx = (src: string) => renameTemplate(src, keys);
	// Formulas and texts (mapStepTexts), then the types, filters and workflows steps name.
	const step = (s: WorkflowStep): WorkflowStep => {
		if (s.kind === "linked") return { ...s, source: s.source.dir === "in" ? { ...s.source, type: renameTarget(s.source.type, keys) } : s.source, when: renameFilter(s.when, keys), steps: s.steps.map(step) };
		if (s.kind === "each") return { ...s, itemType: s.itemType ? renameTarget(s.itemType, keys) : s.itemType, when: renameFilter(s.when, keys), steps: s.steps.map(step) };
		if (s.kind === "if") return { ...s, when: renameFilter(s.when, keys), steps: s.steps.map(step), otherwise: s.otherwise.map(step) };
		if (s.kind === "find") return { ...s, types: s.types.map((x) => renameTarget(x, keys)), when: renameFilter(s.when, keys), ...(s.sort ? { sort: { ...s.sort, by: renameColumnId(s.sort.by, keys) } } : {}) };
		if (s.kind === "create") return { ...s, type: renameTarget(s.type, keys) };
		if (s.kind === "run") return { ...s, workflow: ids.get(s.workflow) ?? s.workflow };
		return s;
	};
	const t = wf.trigger;
	// A form's link fields may point at renamed types.
	const trigger = t.kind === "form" ? { ...t, fields: t.fields.map((x) => (x.targets ? { ...x, targets: x.targets.map((y) => renameTarget(y, keys)) } : x)) } : t;
	return { ...wf, scope: wf.scope.map((x) => renameTarget(x, keys)), trigger, when: renameFilter(wf.when, keys), steps: mapStepTexts(wf.steps, f, tx).map(step) };
}

/**
 * References to renamed types in a view: the types it shows, links-from-a-type columns ("in:<type>.<field>") wherever
 * a column id goes, roll-ups through them, formulas, filters, and the calendar's per-type dates.
 */
export function renameViewKeys(def: ViewDef, keys: Map<string, string>): ViewDef {
	if (!keys.size) return def;
	const id = (x: string) => renameColumnId(x, keys);
	const ids = (xs: string[]) => xs.map(id);
	const byId = <T>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [id(k), v]));
	const grp = (g: GroupBy) => ({ ...g, by: id(g.by) });
	const col = (c: ColumnDef): ColumnDef => {
		if (c.kind === "incoming") {
			const type = renameTarget(c.type, keys);
			return { ...c, type, id: id(c.id) };
		}
		if (c.kind === "rollup") return { ...c, rollup: { ...c.rollup, via: id(c.rollup.via), ...(c.rollup.where ? { where: renameFilter(c.rollup.where, keys) } : {}) } };
		if (c.kind === "formula") return { ...c, formula: renameFormula(c.formula, keys) };
		return c;
	};
	const out: ViewDef = {
		...def,
		types: def.types.map((x) => renameTarget(x, keys)),
		columns: def.columns.map(col),
		widths: byId(def.widths),
		fill: ids(def.fill),
		wrap: ids(def.wrap),
		formats: byId(def.formats),
		summary: byId(def.summary),
		sort: def.sort.map((s) => ({ ...s, by: id(s.by) })),
		group: def.group.map(grp),
		filters: renameFilter(def.filters, keys),
		highlight: def.highlight.map((r) => ({ ...r, target: id(r.target), when: renameFilter(r.when, keys) })),
		...(def.freeze ? { freeze: id(def.freeze) } : {}),
	};
	if (def.board)
		out.board = {
			...def.board,
			...(def.board.buckets ? { buckets: id(def.board.buckets) } : {}),
			...(def.board.swimlanes ? { swimlanes: grp(def.board.swimlanes) } : {}),
			...(def.board.cardFields ? { cardFields: ids(def.board.cardFields) } : {}),
		};
	if (def.calendar)
		out.calendar = {
			...def.calendar,
			dates: Object.fromEntries(Object.entries(def.calendar.dates).map(([k, v]) => [renameTarget(k, keys), v])),
			...(def.calendar.colorBy ? { colorBy: id(def.calendar.colorBy) } : {}),
			...(def.calendar.swimlanes ? { swimlanes: grp(def.calendar.swimlanes) } : {}),
			...(def.calendar.cardFields ? { cardFields: ids(def.calendar.cardFields) } : {}),
		};
	return out;
}

/**
 * Whether a view shows only the given types: every entry of its types list is one of `typeKeys` or a group in
 * `groupKeys` ("*", every type, never is).
 */
export const viewOnlyOver = (viewTypes: string[], typeKeys: Set<string>, groupKeys: Set<string> = new Set()): boolean =>
	viewTypes.length > 0 && viewTypes.every((x) => typeKeys.has(x) || (x.startsWith("@") && groupKeys.has(x.slice(1))));

/**
 * The workflows to export with some types: those that apply only to them (a scope of these types, or their groups'),
 * and the workflows those run ("Run another workflow"), whatever they apply to.
 */
export function packWorkflows(packTypes: EntityTypeDef[], all: WorkflowDef[], allTypes: EntityTypeDef[]): WorkflowDef[] {
	const keys = new Set(packTypes.map((t) => t.key));
	const picked = new Map<string, WorkflowDef>();
	const add = (w: WorkflowDef) => {
		if (picked.has(w.id)) return;
		picked.set(w.id, w);
		for (const s of flatSteps(w.steps))
			if (s.kind === "run") {
				const sub = all.find((x) => x.id === s.workflow);
				if (sub) add(sub);
			}
	};
	for (const w of all) {
		const st = scopeTypes(w, allTypes);
		if (w.scope.length && st.length && st.every((t) => keys.has(t.key))) add(w);
	}
	return [...picked.values()].map(cloneWorkflow);
}

/** A file name (or path) numbered until it's free: "Person.md" → "Person 2.md", "Person 3.md" … */
export function numberedFile(name: string, taken: (name: string) => boolean): string {
	if (!taken(name)) return name;
	const m = /^(.*?)(\.[^./]+)?$/.exec(name)!;
	let n = 2;
	while (taken(`${m[1]} ${n}${m[2] ?? ""}`)) n++;
	return `${m[1]} ${n}${m[2] ?? ""}`;
}

/**
 * Imported workflows' view lists, pointed at the view notes the pack's views were written as (`moved`: path in the
 * pack → path here). Paths that aren't the pack's and aren't views here (`exists`) are dropped.
 */
export function remapWorkflowViews(workflows: WorkflowDef[], moved: Map<string, string>, exists: (path: string) => boolean): void {
	for (const w of workflows) {
		if (!w.views) continue;
		const next = [...new Set(w.views.flatMap((p) => (moved.has(p) ? [moved.get(p)!] : exists(p) ? [p] : [])))];
		if (next.length) w.views = next;
		else delete w.views;
	}
}
function nameToKey(name: string): string {
	const k = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return isValidKey(k) ? k : `type_${k || "new"}`;
}
