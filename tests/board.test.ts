import { describe, expect, it } from "vitest";
import { isoDateAdapter } from "../src/model/dates";
import { CRM_PACK, STARTER_PACK } from "../src/model/packs";
import { extractEdges } from "../src/model/relations";
import { applyBucketOrder, boardRunDef, bucketColumn, bucketStep, moveBucketOrder, bucketColumns, bucketsOf, BUCKET_NONE, cardFieldIds, cardWidth, defaultBuckets, isBucketColumn, orderRows, reorder, typesWithField } from "../src/model/board";
import { emptyBoard, parseView, resolveColumn, runView, serializeView, columnFromId, type ViewContext, type ViewDef, type ViewRow } from "../src/model/views";

const TYPES = [...STARTER_PACK.types, ...CRM_PACK.types];
const GROUPS = [...STARTER_PACK.groups!, ...CRM_PACK.groups!];
const T = (key: string) => TYPES.find((t) => t.key === key)!;
const row = (name: string, type: string, status: string | null, fm: Record<string, unknown> = {}): ViewRow => ({
	path: `${name}.md`,
	name,
	type: T(type),
	status,
	subtitle: null,
	tags: [],
	aliases: [],
	folder: "",
	mtime: 0,
	order: null,
	frontmatter: { entity: type, status, ...fm },
});
const ROWS: ViewRow[] = [
	row("Ada", "person", "active"),
	row("Acme", "organisation", "active", { kind: "Company" }),
	row("Globex", "organisation", "draft", { kind: "Non-profit" }),
	row("Initech", "organisation", "active"),
	row("Oddball", "organisation", "archived", { kind: "Guild" }),
	row("Apollo", "project", "idea", { owner: "[[Ada]]", team: ["[[Ada]]"] }),
	row("Lander", "project", "done", { owner: "[[Grace]]" }),
	row("Zeta", "project", "active", { owner: "[[Ada]]" }),
	row("Orbit", "project", null),
	row("Grace", "person", "draft"),
];
const byName = new Map(ROWS.map((r) => [r.name, r]));
const byPath = new Map(ROWS.map((r) => [r.path, r]));
const resolve = (p: string) => (byName.has(p) ? `${p}.md` : null);
const EDGES = ROWS.flatMap((r) => extractEdges(r.path, r.type, r.frontmatter, resolve));
const ctx: ViewContext = {
	types: TYPES,
	groups: GROUPS,
	dates: isoDateAdapter,
	today: 0,
	resolve: (p) => resolve(p),
	row: (p) => byPath.get(p),
	incoming: (p) => EDGES.filter((e) => e.target === p).map((e) => ({ source: e.source, sourceType: e.sourceType, fieldKey: e.fieldKey })),
};
const view = (raw: Record<string, unknown>): ViewDef => {
	const { def, errors } = parseView(raw);
	expect(errors).toEqual([]);
	return def!;
};
/** bucket key → card names, for a board view */
const board = (raw: Record<string, unknown>) => {
	const def = view(raw);
	const run = boardRunDef(def);
	const res = runView(run, ROWS, ctx);
	const col = bucketColumn(def, ctx)!;
	return { def, res, col, buckets: bucketsOf(col, res.rows, def.board!) };
};
const summary = (bs: { key: string; rows: { row: ViewRow }[] }[]) => Object.fromEntries(bs.map((b) => [b.key, b.rows.map((r) => r.row.name).join(",")]));

describe("board definition", () => {
	it("round-trips board settings under board:, leaving out defaults", () => {
		const raw = {
			kind: "board",
			types: ["project"],
			columns: ["name", "status", "owner", "due"],
			board: {
				buckets: "status",
				swimlanes: "owner",
				cardFields: ["owner", "due", "owner"],
				cardSize: "large",
				cardSubtitle: true,
				cardLabels: true,
				hideEmpty: true,
				collapsedBuckets: ["done"],
				hiddenBuckets: ["on-hold"],
				limits: { active: 3, idea: 0, x: "no" },
				order: { idea: ["Apollo.md", "Zeta.md"], empty: [] },
			},
		};
		const def = view(raw);
		expect(def.kind).toBe("board");
		expect(def.board).toEqual({
			buckets: "status",
			swimlanes: { by: "owner" },
			cardFields: ["owner", "due"],
			cardSize: "large",
			cardSubtitle: true,
			cardLabels: true,
			hideEmpty: true,
			collapsedBuckets: ["done"],
			hiddenBuckets: ["on-hold"],
			limits: { active: 3 },
			order: { idea: ["Apollo.md", "Zeta.md"], empty: [] },
		});
		const out = serializeView(def);
		expect(out.board).toEqual({ ...raw.board, cardFields: ["owner", "due"], limits: { active: 3 }, order: { idea: ["Apollo.md", "Zeta.md"] } });
		expect(view(out)).toEqual({ ...def, board: { ...def.board, order: { idea: ["Apollo.md", "Zeta.md"] } } });
		// swimlanes by date, and an empty board writes nothing
		expect(serializeView(view({ board: { swimlanes: { by: "due", date: "month" } } })).board).toEqual({ swimlanes: { by: "due", date: "month" } });
		expect(serializeView({ ...view({}), board: emptyBoard() }).board).toBeUndefined();
	});

	it("keeps the table's settings when it's a board, and the board's when it's a table", () => {
		const def = view({ kind: "table", columns: ["status", "owner"], widths: { owner: 200 }, freeze: "owner", board: { buckets: "status", cardFields: ["owner"] } });
		const out = serializeView({ ...def, kind: "board" });
		expect(out).toMatchObject({ kind: "board", widths: { owner: 200 }, freeze: "owner", board: { buckets: "status", cardFields: ["owner"] } });
		expect(serializeView({ ...view(out), kind: "table" }).board).toEqual({ buckets: "status", cardFields: ["owner"] });
	});

	it("keeps formats and summaries of card fields that aren't table columns", () => {
		const def = view({ columns: ["status"], formats: { due: "D MMM", gone: "x" }, summary: { due: "earliest" }, board: { cardFields: ["due"] } });
		expect(serializeView(def)).toMatchObject({ formats: { due: "D MMM" }, summary: { due: "earliest" } });
	});

	it("reports bad board settings", () => {
		const { errors } = parseView({ board: { swimlanes: 5, cardSize: "huge" } });
		expect(errors).toEqual(["board swimlanes should be a column id: 5.", 'Unknown card size "huge". Use small, medium or large.']);
		expect(parseView({ board: "status" }).errors).toEqual(["board should be a set of keys like buckets:, cardFields:."]);
	});

	it("card widths per size", () => {
		expect([cardWidth(view({})), cardWidth(view({ board: { cardSize: "small" } })), cardWidth(view({ board: { cardSize: "large" } }))]).toEqual([280, 220, 360]);
	});
});

describe("bucket fields", () => {
	it("offers status and the entity's own single-value choice, checkbox and link fields", () => {
		const ids = (types: string[]) => bucketColumns(view({ types }), ctx).map((c) => c.id);
		expect(ids(["project"])).toEqual(["status", "owner", "client", "parent_project"]);
		expect(ids(["organisation"])).toEqual(["status", "kind", "located_in", "part_of"]);
		// lists, multi-links, text, numbers and dates aren't offered
		expect(ids(["deal"])).toEqual(["status", "company"]);
		expect(defaultBuckets(view({ types: ["project"] }), ctx)).toBe("status");
	});

	it("never accepts read-only columns", () => {
		const def = view({ types: ["project"], columns: [{ formula: "1", label: "F" }, { rollup: { via: "in:note.project", agg: "count" }, label: "R" }] });
		for (const c of [...def.columns, columnFromId("type"), columnFromId("folder"), columnFromId("in:note.project"), columnFromId("tags"), columnFromId("team")]) expect(isBucketColumn(resolveColumn(c, def, ctx))).toBe(false);
		expect(bucketColumn({ ...def, board: { ...emptyBoard(), buckets: "team" } }, ctx)).toBeNull();
	});

	it("knows which types have the field", () => {
		const def = view({ types: ["*"] });
		const kind = resolveColumn(columnFromId("kind"), def, ctx);
		expect(typesWithField(def, kind, TYPES).map((t) => t.key)).toEqual(["organisation", "place"]);
	});
});

describe("card fields", () => {
	it("default to the table's first four columns, without the bucket and swimlane columns", () => {
		const def = view({ columns: ["name", "status", "owner", "due", "client", "team", "start"], board: { buckets: "status", swimlanes: "owner" } });
		expect(cardFieldIds(def)).toEqual(["due", "client", "team", "start"]);
		// Picked fields are shown as picked, the bucket and swimlane columns included.
		expect(cardFieldIds({ ...def, board: { ...def.board!, cardFields: ["status", "team", "name", "owner", "description"] } })).toEqual(["status", "team", "owner", "description"]);
	});

	it("run as name, the card fields and the bucket column, grouped by the swimlane only", () => {
		const def = view({ columns: ["name", "status", { formula: "1+1", label: "Two" }], group: ["status", "owner"], board: { buckets: "status", cardFields: ["two", "due"], swimlanes: "owner" } });
		const run = boardRunDef(def);
		expect(run.columns.map((c) => `${c.kind}:${c.id}`)).toEqual(["builtin:name", "formula:two", "field:due", "builtin:status"]);
		expect(run.group).toEqual([{ by: "owner" }]);
		expect(boardRunDef({ ...def, board: { ...def.board!, swimlanes: undefined } }).group).toEqual([]);
	});
});

describe("buckets", () => {
	it("by status: every status of the types in order, empty ones included; the empty bucket only when used", () => {
		const { buckets } = board({ types: ["project"], board: { buckets: "status" } });
		expect(summary(buckets)).toEqual({ idea: "Apollo", active: "Zeta", "on-hold": "", done: "Lander", [BUCKET_NONE]: "Orbit" });
		expect(buckets.map((b) => b.value)).toEqual(["idea", "active", "on-hold", "done", null]);
		expect(summary(board({ types: ["person"], board: { buckets: "status" } }).buckets)).toEqual({ draft: "Grace", active: "Ada", archived: "" });
	});

	it("by choice: options in order, values that aren't options after them, and the empty bucket last", () => {
		const { buckets } = board({ types: ["organisation"], board: { buckets: "kind" } });
		expect(summary(buckets)).toEqual({ Company: "Acme", "Non-profit": "Globex", Government: "", Community: "", Other: "", Guild: "Oddball", [BUCKET_NONE]: "Initech" });
		expect(buckets[buckets.length - 1].label).toBe("");
	});

	it("by link: the linked notes A→Z by name, then the empty bucket", () => {
		const { buckets } = board({ types: ["project"], board: { buckets: "owner" } });
		expect(buckets.map((b) => `${b.key}=${b.label}:${b.rows.map((r) => r.row.name)}`)).toEqual(["Ada.md=Ada:Apollo,Zeta", "Grace.md=Grace:Lander", `${BUCKET_NONE}=:Orbit`]);
		expect(buckets.map((b) => b.value)).toEqual(["Ada.md", "Grace.md", null]);
	});

	it("by checkbox: No then Yes", () => {
		const def = view({ types: ["task"] });
		const col = { ...resolveColumn(columnFromId("status"), def, ctx), kind: "bool" as const };
		const rows = [true, false, undefined].map((v, i) => ({ row: row(`T${i}`, "project", null), cells: { status: { value: v ?? null, text: "", sort: 0 } } }));
		const bs = bucketsOf(col, rows, emptyBoard());
		expect(bs.map((b) => `${b.key}/${b.label}/${String(b.value)}:${b.rows.map((r) => r.row.name)}`)).toEqual(["no/No/false:T1,T2", "yes/Yes/true:T0"]);
	});

	it("flags hidden buckets and can leave out empty ones", () => {
		const { buckets } = board({ types: ["project"], board: { buckets: "status", hiddenBuckets: ["done"], hideEmpty: true } });
		expect(buckets.map((b) => `${b.key}${b.hidden ? " (hidden)" : ""}`)).toEqual(["idea", "active", "done (hidden)", BUCKET_NONE]);
	});

	it("keep the view's sort within each bucket", () => {
		const { buckets } = board({ types: ["organisation"], sort: [{ by: "name", dir: "desc" }], board: { buckets: "status" } });
		expect(summary(buckets).active).toBe("Initech,Acme");
	});
});

describe("manual card order", () => {
	const rows = ["A", "B", "C", "D"].map((n) => ({ row: row(n, "project", null), cells: {} }));
	it("puts saved paths first, new cards at the bottom", () => {
		expect(orderRows(rows, ["C.md", "gone.md", "A.md"]).map((r) => r.row.name)).toEqual(["C", "A", "B", "D"]);
		expect(orderRows(rows, undefined)).toBe(rows);
	});

	it("moves cards before another, or to the end", () => {
		const ps = ["A", "B", "C", "D"];
		expect(reorder(ps, ["D"], "B")).toEqual(["A", "D", "B", "C"]);
		expect(reorder(ps, ["A", "C"], "D")).toEqual(["B", "A", "C", "D"]);
		expect(reorder(ps, ["B"], null)).toEqual(["A", "C", "D", "B"]);
		expect(reorder(ps, ["B"], "B")).toEqual(["A", "C", "D", "B"]);
		expect(reorder(ps, ["X"], "C")).toEqual(["A", "B", "X", "C", "D"]);
	});
});

describe("bucket order", () => {
	it("round-trips, never saving the empty bucket", () => {
		const def = view({ board: { buckets: "status", bucketOrder: ["done", "(none)", "idea", "done"] } });
		expect(def.board!.bucketOrder).toEqual(["done", "idea"]);
		expect(serializeView(def).board).toEqual({ buckets: "status", bucketOrder: ["done", "idea"] });
		expect(view({ board: { bucketOrder: [] } }).board!.bucketOrder).toBeUndefined();
	});

	it("applies the saved order; unknown keys go after their neighbour in the field's order", () => {
		const nat = ["idea", "active", "on-hold", "done"];
		expect(applyBucketOrder(nat, undefined)).toEqual(nat);
		expect(applyBucketOrder(nat, ["done", "idea", "active", "on-hold"])).toEqual(["done", "idea", "active", "on-hold"]);
		// "on-hold" is new: after "active", its neighbour in the field's order; "gone" is dropped
		expect(applyBucketOrder(nat, ["done", "gone", "active", "idea"])).toEqual(["done", "active", "on-hold", "idea"]);
		// new keys at the start of the field's order go first, in order
		expect(applyBucketOrder(["a", "b", "c", "d"], ["d", "c"])).toEqual(["a", "b", "d", "c"]);
		expect(applyBucketOrder([...nat, BUCKET_NONE], ["done"])).not.toContain(BUCKET_NONE);
	});

	it("keeps the empty bucket last in a board", () => {
		const { buckets } = board({ types: ["project"], board: { buckets: "status", bucketOrder: ["done", "idea"] } });
		expect(buckets.map((b) => b.key)).toEqual(["done", "idea", "active", "on-hold", BUCKET_NONE]);
		const choice = board({ types: ["organisation"], board: { buckets: "kind", bucketOrder: ["Other", "Company"] } }).buckets;
		// Guild (a value that isn't an option) follows Other, its neighbour in the field's order
		expect(choice.map((b) => b.key)).toEqual(["Other", "Guild", "Company", "Non-profit", "Government", "Community", BUCKET_NONE]);
	});

	it("moves a bucket, saving nothing when it's back in the field's order", () => {
		const nat = ["idea", "active", "on-hold", "done", BUCKET_NONE];
		expect(moveBucketOrder(nat, nat, "done", "idea")).toEqual(["done", "idea", "active", "on-hold"]);
		expect(moveBucketOrder(nat, nat, "idea", null)).toEqual(["active", "on-hold", "done", "idea"]);
		// dropping on the empty bucket lands before it
		expect(moveBucketOrder(nat, nat, "idea", BUCKET_NONE)).toEqual(["active", "on-hold", "done", "idea"]);
		const moved = ["done", "idea", "active", "on-hold", BUCKET_NONE];
		expect(moveBucketOrder(moved, nat, "done", null)).toBeUndefined();
		// the empty bucket can't move
		expect(moveBucketOrder(nat, nat, BUCKET_NONE, "idea")).toBeUndefined();
	});

	it("steps a bucket left or right among the shown ones", () => {
		const shown = ["a", "b", "c", BUCKET_NONE];
		expect([bucketStep(shown, "b", -1), bucketStep(shown, "b", 1), bucketStep(shown, "a", 1)]).toEqual(["a", null, "c"]);
		expect([bucketStep(shown, "a", -1), bucketStep(shown, "c", 1), bucketStep(shown, BUCKET_NONE, -1)]).toEqual([undefined, undefined, undefined]);
	});
});
