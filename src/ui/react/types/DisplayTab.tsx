import { KIND_INFO, useEditor } from "./editor";
import { OrderedPicker, Row, Section, Toggle } from "./controls";
import { layoutFields, normaliseLayout } from "../../../model/formLayout";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Hierarchy (parent fields), the subtitle shown in pickers and search, and properties form options. */
export function DisplayTab() {
	const { draft, update, issuesAt, allTypes, setTab } = useEditor();
	const t = draft.type;
	const card = t.card ?? {};
	const relations = t.fields.filter((f) => f.kind === "relation" && f.key);
	const subtitleOptions = t.fields.filter((f) => f.kind !== "relation" && f.key).map((f) => ({ value: f.key, label: f.label || f.key, icon: KIND_INFO[f.kind].icon }));
	const setCard = (fn: (c: NonNullable<typeof t.card>) => void) =>
		update((x) => {
			const c = { ...(x.card ?? {}) };
			fn(c);
			for (const k of Object.keys(c) as (keyof typeof c)[]) if (c[k] === undefined) delete c[k];
			if (Object.keys(c).length) x.card = c;
			else delete x.card;
		});

	const parent = relations.find((f) => f.key === t.parentFields?.[0]);
	const layout = t.form?.layout ? normaliseLayout(t.form.layout) : null;
	const setForm = (fn: (f: NonNullable<typeof t.form>) => void) =>
		update((x) => {
			const f = { ...(x.form ?? {}) };
			fn(f);
			for (const k of Object.keys(f) as (keyof typeof f)[]) if (f[k] === undefined) delete f[k];
			if (Object.keys(f).length) x.form = f;
			else delete x.form;
		});
	const parentTargets = parent ? (parent.targets ?? []).map((k) => allTypes.find((x) => x.key === k)?.name ?? k).join(" or ") : "";
	const hierarchyDesc = parent
		? `In the browser, ${(t.plural || "these notes").toLowerCase()} nest under their ${parentTargets || "parent"} (via “${parent.label}”). With several, the first one that's filled in wins.`
		: "Pick the relation fields that point at this note's parent. The browser builds trees from them, and “Inside its parent” folders use them.";

	return (
		<div className="oe-tm-display">
			<Section title="Hierarchy" desc={hierarchyDesc}>
				<Row label="Parent fields" issues={issuesAt("parentFields")} stacked>
					<OrderedPicker
						label="Parent fields"
						empty={relations.length ? "No parent: notes of this type are listed flat." : "Add a relation field first."}
						values={t.parentFields ?? []}
						options={relations.map((f) => ({ value: f.key, label: f.label || f.key, icon: "link" }))}
						invalid={issuesAt("parentFields").length > 0}
						onChange={(v) => update((x) => (v.length ? (x.parentFields = v) : delete x.parentFields))}
					/>
				</Row>
			</Section>

			<Section title="Subtitle" desc="A one-line description shown under the name in link pickers, Find entity, chip tooltips, the browser and the properties form.">
				<Row label="Subtitle fields" desc="Values are joined with “ · ”. Empty ones are skipped." issues={issuesAt("card:subtitle")} stacked>
					<OrderedPicker
						label="Subtitle fields"
						empty="No subtitle."
						values={card.subtitle ?? []}
						options={subtitleOptions}
						invalid={issuesAt("card:subtitle").length > 0}
						onChange={(v) => setCard((c) => (c.subtitle = v.length ? v : undefined))}
					/>
				</Row>
			</Section>

			<Section title="Properties form" desc="The form that replaces Obsidian's Properties block on notes of this type.">
				<Row label="Hide empty fields" desc="List only fields with a value, with a “Show N empty fields” link for the rest. Fields with a problem are always shown.">
					<Toggle label="Hide empty fields" value={!!t.form?.hideEmpty} onChange={(v) => setForm((f) => (f.hideEmpty = v || undefined))} />
				</Row>
				<Row
					label="Layout"
					desc={
						layout
							? `Custom: ${plural(layout.items.filter((i) => i.kind === "frame").length, "frame")}, ${plural(layoutFields(layout).length, "property", "properties")} placed.`
							: "One list, in field order. Arrange fields in frames and columns on the Layout tab."
					}
				>
					<button type="button" onClick={() => setTab("layout")}>
						{layout ? "Edit layout" : "Design a layout"}
					</button>
				</Row>
			</Section>
		</div>
	);
}
