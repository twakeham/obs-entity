import { typeMatchesTarget, type EntityTypeDef } from "./types";
import { buttonLabel, inScope, type WorkflowDef } from "./workflows";

/** The Entity Browser's search and filters (`query` already trimmed and lower-cased). */
export interface BrowserFilter {
	query: string;
	type: string;
	status: string;
	tag: string;
}

/** Whether a view note matches: its name has the search; with a type, it shows notes of that type. Status and tags are only entities'. */
export function viewMatches(name: string, viewTypes: string[], f: BrowserFilter, types: EntityTypeDef[]): boolean {
	if (f.status || f.tag) return false;
	if (f.query && !name.toLowerCase().includes(f.query)) return false;
	if (!f.type) return true;
	const t = types.find((x) => x.key === f.type);
	return !!t && typeMatchesTarget(t, viewTypes.length ? viewTypes : ["*"]);
}

/**
 * Whether a workflow matches: its name (or button label) has the search; with a type, it applies to that type (a
 * workflow for any note does). Status and tags are only entities'.
 */
export function workflowMatches(wf: WorkflowDef, f: BrowserFilter, types: EntityTypeDef[]): boolean {
	if (f.status || f.tag) return false;
	if (f.query && !wf.name.toLowerCase().includes(f.query) && !buttonLabel(wf).toLowerCase().includes(f.query)) return false;
	if (!f.type) return true;
	const t = types.find((x) => x.key === f.type);
	return !!t && inScope(wf, t);
}

/** Whether an entity type matches: its name, plural or key has the search; with a type, it's that type. Status and tags are only entities'. */
export function typeMatches(t: Pick<EntityTypeDef, "key" | "name" | "plural">, f: BrowserFilter): boolean {
	if (f.status || f.tag) return false;
	if (f.type && t.key !== f.type) return false;
	return !f.query || [t.name, t.plural, t.key].some((s) => (s ?? "").toLowerCase().includes(f.query));
}
