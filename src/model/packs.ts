import { FIELD_KINDS, cloneGroup, cloneType, isValidKey, type EntityTypeDef, type GroupDef } from "./types";

/** A shareable bundle of types (and the groups they use). */
export interface TypePack {
	obsEntitiesPack: 1;
	id?: string;
	name?: string;
	groups?: GroupDef[];
	types: EntityTypeDef[];
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
			card: { subtitle: ["role", "email"], fields: ["works_at", "knows"] },
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
			card: { subtitle: ["industry"], fields: ["website", "subsidiary_of"] },
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
			card: { subtitle: ["description"], fields: ["company", "value", "close_date", "contacts"], incoming: false },
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
	let meta: Record<string, unknown> = {};
	if (Array.isArray(data)) types = data;
	else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).types)) {
		meta = data as Record<string, unknown>;
		types = meta.types as unknown[];
		groups = Array.isArray(meta.groups) ? (meta.groups as unknown[]) : [];
	} else if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).fields)) types = [data];
	else return { ok: false, error: "Expected a pack ({ types: [...] }), a type, or a list of types." };
	if (types.length === 0) return { ok: false, error: "The pack has no types." };

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
}

function uniqueKey(key: string, taken: Set<string>): string {
	if (!taken.has(key)) return key;
	let n = 2;
	while (taken.has(`${key}_${n}`)) n++;
	return `${key}_${n}`;
}

/**
 * Add a pack's types (and missing groups) to existing ones. Clashing type keys get a numbered suffix,
 * and relation targets inside the pack follow the rename. Types whose group is unknown go into the first group.
 */
export function installPack(pack: TypePack, groups: GroupDef[], types: EntityTypeDef[]): InstallResult {
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
	const incoming = pack.types.map((raw) => {
		const t = cloneType(raw);
		const original = t.key && isValidKey(t.key) ? t.key : nameToKey(t.name);
		const key = uniqueKey(original, taken);
		taken.add(key);
		if (key !== t.key) renamed[t.key || t.name] = key;
		t.key = key;
		return { t, original };
	});
	const keyMap = new Map(incoming.map(({ t, original }) => [original, t.key]));
	const added: string[] = [];
	const outTypes = types.map(cloneType);
	for (const { t } of incoming) {
		t.plural = t.plural || `${t.name}s`;
		t.icon = t.icon || "file";
		t.color = t.color || "#9e9e9e";
		t.template = t.template || `${t.name}.md`;
		if (!groupKeys.has(t.group)) t.group = fallbackGroup;
		t.builtIn = false;
		if (pack.id) t.pack = pack.id;
		for (const f of t.fields) {
			if (f.kind === "relation" && f.targets) f.targets = f.targets.map((x) => keyMap.get(x) ?? x);
		}
		outTypes.push(t);
		added.push(t.key);
	}
	return { groups: outGroups, types: outTypes, added, renamed, addedGroups };
}

function nameToKey(name: string): string {
	const k = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return isValidKey(k) ? k : `type_${k || "new"}`;
}
