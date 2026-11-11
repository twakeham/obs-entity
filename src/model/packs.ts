import { FIELD_KINDS, cloneGroup, cloneType, isValidKey, type EntityTypeDef, type GroupDef } from "./types";
import { rewriteRefs } from "./formula";
import { isGroup, type FilterGroup } from "./views";
import { cloneWorkflow, flatSteps, newWorkflowId, parseTemplate, readWorkflows, scopeTypes, type NoteStep, type WorkflowDef, type WorkflowStep } from "./workflows";

/** A shareable bundle of types (and the groups they use), and workflows. */
export interface TypePack {
	obsEntitiesPack: 1;
	id?: string;
	name?: string;
	groups?: GroupDef[];
	types: EntityTypeDef[];
	/** workflows for these types (imported switched off) */
	workflows?: WorkflowDef[];
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
	let meta: Record<string, unknown> = {};
	if (Array.isArray(data)) types = data;
	else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).types)) {
		meta = data as Record<string, unknown>;
		types = meta.types as unknown[];
		groups = Array.isArray(meta.groups) ? (meta.groups as unknown[]) : [];
		if (meta.workflows !== undefined && !Array.isArray(meta.workflows)) return { ok: false, error: "“workflows” should be a list." };
		workflows = Array.isArray(meta.workflows) ? (meta.workflows as unknown[]) : [];
	} else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).fields)) types = [data];
	else return { ok: false, error: "Expected a pack ({ types: [...] }), a type, or a list of types." };
	if (types.length === 0 && workflows.length === 0) return { ok: false, error: "The pack has no types." };
	for (const [i, raw] of workflows.entries()) {
		const w = raw as { name?: unknown; steps?: unknown };
		if (!w || typeof w !== "object" || !Array.isArray(w.steps)) return { ok: false, error: `Workflow ${typeof w?.name === "string" ? `“${w.name}”` : `#${i + 1}`} has no steps list.` };
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
 * steps). Types whose group is unknown go into the first group. Workflows come in switched off, with new ids when
 * theirs are taken ("Run another workflow" steps follow).
 */
export function installPack(pack: TypePack, groups: GroupDef[], types: EntityTypeDef[], workflows: WorkflowDef[] = []): InstallResult {
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
	const outWorkflows = read.map((w) => ({ ...renameWorkflowKeys(w, keyMap, idMap), on: false }));
	return { groups: outGroups, types: outTypes, added, renamed, addedGroups, workflows: outWorkflows };
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
	if (!keys.size || !src.includes("{")) return src;
	let changed = false;
	try {
		const out = parseTemplate(src)
			.map((p) => {
				if ("text" in p) return p.text.replace(/[{}]/g, (c) => c + c);
				const f = renameFormula(p.formula, keys);
				if (f !== p.formula) changed = true;
				return `{${f}}`;
			})
			.join("");
		return changed ? out : src;
	} catch {
		return src;
	}
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
	const note = (s: NoteStep): NoteStep => {
		switch (s.kind) {
			case "set":
				return { ...s, value: f(s.value) };
			case "var":
				return { ...s, value: f(s.value) };
			case "link":
				return { ...s, target: f(s.target) };
			case "notice":
			case "ask":
				return { ...s, text: tx(s.text) };
			case "move":
				return { ...s, folder: tx(s.folder) };
			case "rename":
				return { ...s, name: tx(s.name) };
			case "create":
				return {
					...s,
					type: renameTarget(s.type, keys),
					name: tx(s.name),
					fields: s.fields.map((r) => ({ ...r, value: f(r.value) })),
					...(s.folder ? { folder: tx(s.folder) } : {}),
					...(s.body?.from === "text" ? { body: { ...s.body, text: tx(s.body.text) } } : {}),
				};
			case "run":
				return { ...s, workflow: ids.get(s.workflow) ?? s.workflow };
			default:
				return s;
		}
	};
	const step = (s: WorkflowStep): WorkflowStep => {
		if (s.kind === "linked") return { ...s, source: s.source.dir === "in" ? { ...s.source, type: renameTarget(s.source.type, keys) } : s.source, when: renameFilter(s.when, keys), steps: s.steps.map(step) };
		if (s.kind === "each") return { ...s, formula: f(s.formula), itemType: s.itemType ? renameTarget(s.itemType, keys) : s.itemType, when: renameFilter(s.when, keys), steps: s.steps.map(step) };
		if (s.kind === "if") return { ...s, formula: f(s.formula), when: renameFilter(s.when, keys), steps: s.steps.map(step), otherwise: s.otherwise.map(step) };
		if (s.kind === "find") return { ...s, types: s.types.map((x) => renameTarget(x, keys)), when: renameFilter(s.when, keys), ...(s.sort ? { sort: { ...s.sort, by: renameColumnId(s.sort.by, keys) } } : {}) };
		return note(s);
	};
	return { ...wf, scope: wf.scope.map((x) => renameTarget(x, keys)), when: renameFilter(wf.when, keys), steps: wf.steps.map(step) };
}

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
function nameToKey(name: string): string {
	const k = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return isValidKey(k) ? k : `type_${k || "new"}`;
}
