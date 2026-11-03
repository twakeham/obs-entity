import type { DateAdapter } from "./dates";
import { normaliseLayout, whenParts, type FormLayout, type LayoutCondition, type LayoutNode, type LayoutWhen } from "./formLayout";
import { asArray } from "./links";
import { COMMON_KEYS, type EntityTypeDef, type GroupDef } from "./types";
import { cellOf, columnFromId, conditionIssue, emptyView, fieldColumn, matches, NEEDS_VALUE, OPERATORS, resolveColumn, type ResolvedColumn, type ViewContext, type ViewRow } from "./views";

/**
 * "Show only when…" for a form layout's frames, tabs and slots: conditions on the note's own values, evaluated with the
 * view filters' operators. Conditions that can't be used (a deleted field, a missing value) are ignored; with none
 * usable, the thing shows.
 */
export interface WhenContext {
	types: EntityTypeDef[];
	groups: GroupDef[];
	dates: DateAdapter;
	/** today, in the date adapter's units */
	today: number;
	/** resolve a link path to a note path (for "links to") */
	resolve?: (linkpath: string) => string | null;
	/** the views' context and the note's path: conditions on calculated fields (roll-ups need the other notes) */
	view?: ViewContext;
	path?: string;
}

/** Today as a day number (days since 1970-01-01), like views use. */
export function todayDays(now = new Date()): number {
	return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

/** The columns a condition can test: the type's fields (calculated ones too), status and tags. */
export function whenColumns(type: EntityTypeDef, ctx: Pick<WhenContext, "groups"> & Partial<Pick<WhenContext, "types">>): ResolvedColumn[] {
	const def = emptyView([type.key]);
	// Other types matter for roll-ups through them; this type as given (it may be a draft).
	const c = { types: ctx.types?.length ? [...ctx.types.filter((t) => t.key !== type.key), type] : [type], groups: ctx.groups };
	return [...type.fields.map((f) => resolveColumn(fieldColumn(f.key), def, c)), resolveColumn(columnFromId(COMMON_KEYS.status), def, c), resolveColumn(columnFromId(COMMON_KEYS.tags), def, c)];
}

function viewContext(ctx: WhenContext): ViewContext {
	return ctx.view ?? { types: ctx.types, groups: ctx.groups, dates: ctx.dates, today: ctx.today, resolve: (lp) => ctx.resolve?.(lp) ?? null, row: () => undefined, incoming: () => [] };
}

function rowOf(type: EntityTypeDef, values: Record<string, unknown>, path = ""): ViewRow {
	const status = values[COMMON_KEYS.status];
	return {
		path,
		name: "",
		type,
		status: typeof status === "string" && status ? status : null,
		subtitle: null,
		tags: asArray(values[COMMON_KEYS.tags]).map((t) => String(t).replace(/^#/, "")),
		mtime: 0,
		order: null,
		frontmatter: values,
		aliases: [],
		folder: "",
	};
}

/** Whether a "show only when" holds for these values (true when none of its conditions can be used). */
export function evalWhen(w: LayoutWhen, type: EntityTypeDef, values: Record<string, unknown>, ctx: WhenContext): boolean {
	const cols = new Map(whenColumns(type, ctx).map((c) => [c.id, c]));
	const vctx = viewContext(ctx);
	const { mode, items } = whenParts(w);
	const usable = items.filter((c) => !conditionIssue(c, cols, vctx));
	if (!usable.length) return true;
	const row = rowOf(type, values, ctx.path);
	const test = (c: LayoutCondition) => {
		const col = cols.get(c.field)!;
		return matches(cellOf(row, col, vctx), col.kind, c, vctx);
	};
	return mode === "all" ? usable.every(test) : usable.some(test);
}

/** Why each unusable condition is ignored (for the designer); a missing value is only "still being set up". */
export function conditionProblems(w: LayoutWhen, type: EntityTypeDef, ctx: WhenContext): { cond: LayoutCondition; issue: string; incomplete: boolean }[] {
	const cols = new Map(whenColumns(type, ctx).map((c) => [c.id, c]));
	const vctx = viewContext(ctx);
	return whenParts(w).items.flatMap((cond) => {
		const issue = conditionIssue(cond, cols, vctx);
		if (!issue) return [];
		return [{ cond, issue: cols.has(cond.field) ? issue : `“${columnFromId(cond.field).kind === "field" ? (columnFromId(cond.field) as { key: string }).key : cond.field}” isn't a field of this type.`, incomplete: issue === NEEDS_VALUE }];
	});
}

/** Conditions on fields the type doesn't have (deleted ones), for type validation. */
export function whenIssues(layout: FormLayout, type: EntityTypeDef, groups: GroupDef[]): string[] {
	const ids = new Set(whenColumns(type, { groups }).map((c) => c.id));
	const out: string[] = [];
	const check = (w: LayoutWhen | undefined, what: string) => {
		if (!w) return;
		for (const c of whenParts(w).items) {
			if (ids.has(c.field)) continue;
			const col = columnFromId(c.field);
			out.push(`“Show only when” on ${what} uses “${col.kind === "field" ? col.key : c.field}”, which isn't a field of this type. It's ignored until it's fixed.`);
		}
	};
	const visit = (nodes: LayoutNode[]) =>
		nodes.forEach((n) => {
			if (n.kind === "field") check(n.when, `the ${n.key} slot`);
			else if (n.kind === "frame") {
				check(n.when, n.caption ? `the “${n.caption}” frame` : "a frame");
				visit(n.items);
			} else if (n.kind === "columns") n.columns.forEach(visit);
			else if (n.kind === "tabs")
				n.tabs.forEach((t) => {
					check(t.when, `the “${t.caption}” tab`);
					visit(t.items);
				});
		});
	visit(layout.items);
	return out;
}

const basename = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/, "");

/** A condition's value in words. */
function valueText(col: ResolvedColumn | undefined, v: unknown): string {
	if (v === undefined || v === null || v === "") return "";
	const list = Array.isArray(v) ? v : [v];
	const parts = list.filter((x) => x !== undefined && x !== null && String(x) !== "").map((x) => (col?.kind === "links" ? basename(String(x)) : String(x)));
	return parts.join(", ");
}

/** A "show only when" in words, e.g. "Likelihood is any of High and Impact is not empty". */
export function whenText(w: LayoutWhen, type: EntityTypeDef, ctx: Pick<WhenContext, "groups">): string {
	const cols = new Map(whenColumns(type, ctx).map((c) => [c.id, c]));
	const { mode, items } = whenParts(w);
	return items
		.map((c) => {
			const col = cols.get(c.field);
			const op = col ? OPERATORS[col.kind].find((o) => o.op === c.op) : undefined;
			const value = op && op.value !== "none" ? valueText(col, c.value) : "";
			return `${col?.label ?? c.field} ${op?.label ?? c.op}${value ? ` ${value}` : ""}`;
		})
		.join(mode === "all" ? " and " : " or ");
}

/**
 * Keys of the fields a type's layout hides for these values: their slot's condition, or a frame's or tab's they're in,
 * doesn't hold. (Columns have no conditions.)
 */
export function hiddenFields(layout: FormLayout, type: EntityTypeDef, values: Record<string, unknown>, ctx: WhenContext): Set<string> {
	const out = new Set<string>();
	const off = (w: LayoutWhen | undefined) => !!w && !evalWhen(w, type, values, ctx);
	const visit = (nodes: LayoutNode[], hidden: boolean) =>
		nodes.forEach((n) => {
			if (n.kind === "field") {
				if (hidden || off(n.when)) out.add(n.key);
			} else if (n.kind === "frame") visit(n.items, hidden || off(n.when));
			else if (n.kind === "columns") n.columns.forEach((c) => visit(c, hidden));
			else if (n.kind === "tabs") n.tabs.forEach((t) => visit(t.items, hidden || off(t.when)));
		});
	visit(layout.items, false);
	return out;
}

/** `hiddenFields` for a type's own layout (none without one). */
export function typeHiddenFields(type: EntityTypeDef, values: Record<string, unknown>, ctx: WhenContext): Set<string> {
	const layout = type.form?.layout ? normaliseLayout(type.form.layout) : null;
	return layout ? hiddenFields(layout, type, values, ctx) : new Set();
}
