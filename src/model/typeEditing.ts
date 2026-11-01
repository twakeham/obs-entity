import { isEmptyValue } from "./frontmatter";
import { installPack, parsePack, type TypePack } from "./packs";
import { cloneGroup, cloneType, isValidKey, toKey, type EntityTypeDef, type FieldDef, type GroupDef, type RelationTarget } from "./types";

// ---------------------------------------------------------------- type drafts

/** Per-field bookkeeping for a draft: a stable id and the key the field had when editing started. */
export interface FieldMeta {
	uid: string;
	/** key in the saved type, null for fields added in this draft */
	origKey: string | null;
}

/** A type being edited: a working copy plus what it was when editing started. */
export interface TypeDraft {
	type: EntityTypeDef;
	/** saved definition, null for a type that hasn't been saved yet */
	original: EntityTypeDef | null;
	/** parallel to type.fields */
	meta: FieldMeta[];
}

let uidCounter = 0;
export const newUid = (): string => `f${++uidCounter}`;

export function makeDraft(original: EntityTypeDef | null, working?: EntityTypeDef): TypeDraft {
	const type = cloneType(working ?? original!);
	return {
		type,
		original: original ? cloneType(original) : null,
		meta: type.fields.map((f) => ({ uid: newUid(), origKey: original?.fields.some((o) => o.key === f.key) ? f.key : null })),
	};
}

export function isDirty(d: TypeDraft): boolean {
	return !d.original || JSON.stringify(d.type) !== JSON.stringify(d.original);
}

/** Fill in defaults a user may leave empty (plural, template) and tidy empty optional settings. */
export function finaliseType(t: EntityTypeDef): EntityTypeDef {
	const out = cloneType(t);
	out.name = out.name.trim();
	out.plural = out.plural.trim() || `${out.name}s`;
	out.template = out.template.trim() || `${out.name}.md`;
	if (out.shortcuts && out.shortcuts.length === 0) delete out.shortcuts;
	if (out.statuses && out.statuses.length === 0) delete out.statuses;
	if (out.parentFields && out.parentFields.length === 0) delete out.parentFields;
	if (typeof out.folderPattern === "string") out.folderPattern = out.folderPattern.trim();
	return out;
}

/**
 * Keep references to a field (subtitle, parent fields) in step when its key changes.
 * `to` null means the field was deleted.
 */
export function renameFieldRefs(t: EntityTypeDef, from: string, to: string | null): void {
	if (!from || from === to) return;
	const swap = (list: string[] | undefined) => {
		if (!list) return list;
		const out = list.flatMap((k) => (k === from ? (to ? [to] : []) : [k]));
		return out.filter((k, i) => out.indexOf(k) === i);
	};
	t.parentFields = swap(t.parentFields);
	if (t.card) t.card.subtitle = swap(t.card.subtitle);
}

export interface FieldChanges {
	renames: { from: string; to: string; label: string }[];
	deleted: { key: string; label: string }[];
}

/** Field keys renamed or removed since editing started (only for saved types). */
export function fieldChanges(d: TypeDraft): FieldChanges {
	const out: FieldChanges = { renames: [], deleted: [] };
	if (!d.original) return out;
	const current = new Set(d.type.fields.map((f) => f.key));
	d.type.fields.forEach((f, i) => {
		const from = d.meta[i]?.origKey;
		if (from && from !== f.key && isValidKey(f.key)) out.renames.push({ from, to: f.key, label: f.label });
	});
	const kept = new Set(d.meta.map((m) => m.origKey).filter((k): k is string => !!k));
	for (const f of d.original.fields) {
		if (!kept.has(f.key) && !current.has(f.key)) out.deleted.push({ key: f.key, label: f.label });
	}
	return out;
}

export function hasValue(v: unknown): boolean {
	return !isEmptyValue(v);
}

/**
 * Apply renamed / deleted field keys to one note's frontmatter (mutates `fm`).
 * Renames copy the old value unless the new key already has one, then drop the old key
 * (unless another field still uses it). Returns true if anything changed.
 */
export function migrateFrontmatter(fm: Record<string, unknown>, changes: { renames: { from: string; to: string }[]; deleted: string[] }, currentKeys: Set<string>): boolean {
	let changed = false;
	const old = new Map(changes.renames.map((r) => [r.from, fm[r.from]]));
	const conflicts = new Set<string>();
	for (const r of changes.renames) {
		const v = old.get(r.from);
		if (!hasValue(v)) continue;
		if (hasValue(fm[r.to]) && !changes.renames.some((x) => x.from === r.to)) {
			conflicts.add(r.from);
			continue;
		}
		fm[r.to] = v;
		changed = true;
	}
	for (const r of changes.renames) {
		if (conflicts.has(r.from) || currentKeys.has(r.from) || !(r.from in fm)) continue;
		delete fm[r.from];
		changed = true;
	}
	for (const key of changes.deleted) {
		if (currentKeys.has(key) || !(key in fm)) continue;
		delete fm[key];
		changed = true;
	}
	return changed;
}

/** Notes with a value for `key`, from a list of { path, frontmatter }. */
export function notesWithValue<E extends { path: string; frontmatter: Record<string, unknown> }>(entities: E[], key: string): E[] {
	return entities.filter((e) => hasValue(e.frontmatter[key]));
}

// ---------------------------------------------------------------- group drafts

/** A group being edited. `statusOrig` is parallel to group.statuses: each status's name when editing started. */
export interface GroupDraft {
	group: GroupDef;
	original: GroupDef | null;
	statusOrig: (string | null)[];
}

export function makeGroupDraft(original: GroupDef | null, working?: GroupDef): GroupDraft {
	const group = cloneGroup(working ?? original!);
	return { group, original: original ? cloneGroup(original) : null, statusOrig: group.statuses.map((s) => (original?.statuses.includes(s) ? s : null)) };
}

export function isGroupDirty(d: GroupDraft): boolean {
	return !d.original || JSON.stringify(d.group) !== JSON.stringify(d.original);
}

/** Statuses renamed since editing started. */
export function statusRenames(d: GroupDraft): { from: string; to: string }[] {
	if (!d.original) return [];
	return d.group.statuses.flatMap((s, i) => {
		const from = d.statusOrig[i];
		return from && from !== s && s.trim() ? [{ from, to: s }] : [];
	});
}

/** Group problems, located like type issues ("name", "key", "statuses"). */
export function groupIssues(g: GroupDef, ctx: { groupKeys: string[]; isNew: boolean }): { at: string; message: string }[] {
	const out: { at: string; message: string }[] = [];
	if (!g.name.trim()) out.push({ at: "name", message: "Group name is required." });
	if (!isValidKey(g.key)) out.push({ at: "key", message: g.key ? `Group key "${g.key}" must be lowercase letters, digits or underscores.` : "Give the group a name (the key is filled in from it)." });
	else if (ctx.isNew && ctx.groupKeys.includes(g.key)) out.push({ at: "key", message: `A group with the key "${g.key}" already exists.` });
	if (g.statuses.length === 0) out.push({ at: "statuses", message: "A group needs at least one status." });
	if (g.statuses.some((s) => !s.trim())) out.push({ at: "statuses", message: "Statuses can't be blank." });
	const lower = g.statuses.map((s) => s.trim().toLowerCase());
	if (lower.some((s, i) => lower.indexOf(s) !== i)) out.push({ at: "statuses", message: "Each status can only be listed once." });
	return out;
}

// ---------------------------------------------------------------- relationships

export interface IncomingRelation {
	type: EntityTypeDef;
	field: FieldDef;
	/** targets any type / a whole group, rather than naming this type */
	generic: boolean;
}

/** Relation fields of other types (and this one) that can point at notes of `typeKey` in group `groupKey`. */
export function incomingRelations(typeKey: string, groupKey: string, types: EntityTypeDef[]): IncomingRelation[] {
	const out: IncomingRelation[] = [];
	for (const t of types) {
		for (const f of t.fields) {
			if (f.kind !== "relation") continue;
			const targets = f.targets ?? [];
			if (targets.includes(typeKey)) out.push({ type: t, field: f, generic: false });
			else if (targets.length === 0 || targets.includes("*") || targets.includes(`@${groupKey}`)) out.push({ type: t, field: f, generic: true });
		}
	}
	return out;
}

/** Display name for a relation target. */
export function targetName(target: RelationTarget, types: EntityTypeDef[], plural = true, groups: GroupDef[] = []): string {
	if (target === "*") return plural ? "Any entities" : "Any entity";
	if (target.startsWith("@")) {
		const g = groups.find((x) => x.key === target.slice(1));
		const name = g?.name ?? target.slice(1);
		return plural ? `Any ${name} entities` : `Any ${name} entity`;
	}
	const t = types.find((x) => x.key === target);
	return t ? (plural ? t.plural : t.name) : target;
}

export interface RelationshipSpec {
	label: string;
	targets: RelationTarget[];
	inverse: string;
	many: boolean;
	symmetric: boolean;
	labelled: boolean;
}

/** A unique key derived from `base` ("ship", "ship_2", …). */
export function uniqueKey(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	const root = base || "field";
	if (!set.has(root)) return root;
	for (let i = 2; ; i++) if (!set.has(`${root}_${i}`)) return `${root}_${i}`;
}

/** Field created by the "Add relationship" dialog. */
export function relationshipField(spec: RelationshipSpec, existingKeys: string[]): FieldDef {
	const f: FieldDef = {
		key: uniqueKey(toKey(spec.label), existingKeys),
		label: spec.label.trim(),
		kind: "relation",
		targets: spec.targets.length ? [...spec.targets] : ["*"],
		multiple: spec.many || spec.labelled,
		inModal: true,
	};
	if (spec.inverse.trim()) f.inverse = spec.inverse.trim();
	if (spec.symmetric) f.symmetric = true;
	if (spec.labelled) f.labelled = true;
	return f;
}

/** Plain-English summary of a relationship, shown while it's being set up. */
export function describeRelationship(spec: RelationshipSpec, typeName: string, types: EntityTypeDef[], groups: GroupDef[] = []): string {
	const label = spec.label.trim() || "…";
	const targets = spec.targets.length ? spec.targets : ["*"];
	const many = spec.many || spec.labelled;
	const names = targets.map((t) => targetName(t, types, many, groups)).join(" or ");
	const article = /^[aeiou]/i.test(typeName) ? "An" : "A";
	let s = `${article} ${typeName.toLowerCase()} can link to ${many ? "several" : "one"} ${names.toLowerCase()} through "${label}"`;
	s += spec.labelled ? ", giving each link its own label (e.g. mentor, client)." : ".";
	const other = spec.symmetric ? spec.inverse.trim() || label : spec.inverse.trim();
	if (spec.symmetric) s += ` It reads both ways: the other note lists it as "${other}" too.`;
	else if (other) s += ` On the other note it's listed as "${other}".`;
	else s += ` On the other note it's listed as "${label} (from ${typeName})".`;
	return s;
}

// ---------------------------------------------------------------- duplicate / export / import

export function duplicateType(t: EntityTypeDef, takenKeys: string[]): EntityTypeDef {
	const copy = cloneType(t);
	copy.name = `${t.name} copy`;
	copy.plural = `${t.plural} copy`;
	copy.key = uniqueKey(toKey(copy.name), takenKeys);
	copy.template = "";
	copy.shortcuts = [];
	copy.builtIn = false;
	delete copy.pack;
	return copy;
}

/** A pack holding the given types and the groups they use. */
export function exportPack(types: EntityTypeDef[], groups: GroupDef[], name?: string): string {
	const used = new Set(types.map((t) => t.group));
	const pack: TypePack = {
		obsEntitiesPack: 1,
		...(name ? { name } : {}),
		groups: groups.filter((g) => used.has(g.key)).map(cloneGroup),
		types: types.map((t) => {
			const c = cloneType(t);
			delete (c as Partial<EntityTypeDef>).builtIn;
			delete c.pack;
			return c;
		}),
	};
	return JSON.stringify(pack, null, 2);
}

/**
 * Read a pack (or single type, or list of types) as new types to review. Groups the pack needs
 * that don't exist yet are returned to be added; clashing type keys get a numbered suffix.
 */
export function importAsDrafts(
	text: string,
	groups: GroupDef[],
	types: EntityTypeDef[],
): { error: string } | { types: EntityTypeDef[]; newGroups: GroupDef[]; renamed: Record<string, string> } {
	const parsed = parsePack(text);
	if (!parsed.ok) return { error: parsed.error };
	const res = installPack({ ...parsed.pack, id: undefined }, groups, types);
	const added = new Set(res.added);
	return {
		types: res.types.filter((t) => added.has(t.key)).map((t) => ({ ...t, builtIn: false })),
		newGroups: res.groups.filter((g) => res.addedGroups.includes(g.key)),
		renamed: res.renamed,
	};
}

// ---------------------------------------------------------------- preview samples

export interface SampleNote {
	/** path of the existing note the values came from, if any */
	path: string | null;
	name: string;
	status: string;
	frontmatter: Record<string, unknown>;
	fromNote: boolean;
}

/**
 * Example values for previewing a type: from the existing note of that type with the most
 * values (read through each field's original key), or made up when there are none.
 */
export function sampleValues<E extends { path: string; name: string; status: string | null; frontmatter: Record<string, unknown> }>(
	d: TypeDraft,
	entities: E[],
	opts: { date: string; status: string; targetName: (targets: RelationTarget[] | undefined) => string },
): SampleNote {
	const keyOf = (i: number) => d.meta[i]?.origKey ?? d.type.fields[i].key;
	let best: E | undefined;
	let bestScore = -1;
	for (const e of entities) {
		const score = d.type.fields.filter((_, i) => hasValue(e.frontmatter[keyOf(i)])).length;
		if (score > bestScore) {
			best = e;
			bestScore = score;
		}
	}
	if (best) {
		const fm: Record<string, unknown> = {};
		d.type.fields.forEach((f, i) => (fm[f.key] = best!.frontmatter[keyOf(i)]));
		return { path: best.path, name: best.name, status: best.status ?? opts.status, frontmatter: fm, fromNote: true };
	}
	const fm: Record<string, unknown> = {};
	for (const f of d.type.fields) {
		const example = `Example ${f.label.toLowerCase()}`;
		switch (f.kind) {
			case "text":
			case "textarea":
				fm[f.key] = example;
				break;
			case "number":
				fm[f.key] = 3;
				break;
			case "list":
				fm[f.key] = ["First", "Second"];
				break;
			case "multiselect":
				fm[f.key] = (f.options ?? []).slice(0, 2);
				break;
			case "url":
				fm[f.key] = "https://example.com";
				break;
			case "date":
				fm[f.key] = opts.date;
				break;
			case "select":
				fm[f.key] = f.options?.[0] ?? "";
				break;
			case "boolean":
				fm[f.key] = true;
				break;
			case "relation": {
				const n = opts.targetName(f.targets);
				const label = f.labelled ? "|example" : "";
				fm[f.key] = f.multiple || f.labelled ? [`[[${n} 1${label}]]`, `[[${n} 2]]`] : `[[${n}]]`;
				break;
			}
		}
	}
	const name = d.type.name || "Entity";
	return { path: null, name: `Example ${name.toLowerCase()}`, status: opts.status, frontmatter: fm, fromNote: false };
}
