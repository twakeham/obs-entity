import { DEFAULT_MAX_CHIPS } from "../../../model/card";
import { COMMON_KEYS } from "../../../model/types";
import { usePlugin } from "../context";
import { KIND_INFO, useEditor } from "./editor";
import { OrderedPicker, Row, Section, Segmented, TextInput, Toggle } from "./controls";

/** Hierarchy (parent fields) and what the card, pickers and search show for this type. */
export function DisplayTab() {
	const plugin = usePlugin();
	const { draft, update, issuesAt, allTypes } = useEditor();
	const t = draft.type;
	const card = t.card ?? {};
	const relations = t.fields.filter((f) => f.kind === "relation" && f.key);
	const subtitleOptions = t.fields.filter((f) => f.kind !== "relation" && f.key).map((f) => ({ value: f.key, label: f.label || f.key, icon: KIND_INFO[f.kind].icon }));
	const cardOptions = [
		...t.fields.filter((f) => f.key).map((f) => ({ value: f.key, label: f.label || f.key, icon: KIND_INFO[f.kind].icon })),
		{ value: COMMON_KEYS.related, label: "Related", icon: "link-2" },
	];
	const setCard = (fn: (c: NonNullable<typeof t.card>) => void) =>
		update((x) => {
			const c = { ...(x.card ?? {}) };
			fn(c);
			for (const k of Object.keys(c) as (keyof typeof c)[]) if (c[k] === undefined) delete c[k];
			if (Object.keys(c).length) x.card = c;
			else delete x.card;
		});

	const parent = relations.find((f) => f.key === t.parentFields?.[0]);
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

			<Section title="Subtitle" desc="A one-line description shown under the name in link pickers, Find entity, chip tooltips and on the card.">
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

			<Section title="Info card" desc={plugin.settings.showCard ? "The card at the top of notes of this type." : "The card is turned off for all notes in settings; these apply if it's turned on."}>
				<Row label="Show the card on these notes">
					<Toggle label="Show the card on these notes" value={card.show !== false} onChange={(v) => setCard((c) => (c.show = v ? undefined : false))} />
				</Row>
				<Row label="Fields" desc={card.fields ? "Only these, in this order. Relation fields show as rows of links in their place." : "Every filled field in field order (subtitle fields excluded), then all links."} issues={issuesAt("card:fields")} stacked={!!card.fields}>
					<div className="oe-tm-stack">
						<Segmented
							label="Card fields"
							value={card.fields ? "some" : "all"}
							options={[
								{ value: "all", label: "All filled fields" },
								{ value: "some", label: "Only these" },
							]}
							onChange={(v) =>
								setCard((c) => {
									c.fields = v === "some" ? t.fields.filter((f) => f.key && (f.kind === "relation" || !c.subtitle?.includes(f.key))).map((f) => f.key) : undefined;
								})
							}
						/>
						{card.fields && <OrderedPicker label="Card fields" empty="Nothing but the top row." values={card.fields} options={cardOptions} invalid={issuesAt("card:fields").length > 0} onChange={(v) => setCard((c) => (c.fields = v))} />}
					</div>
				</Row>
				<Row label="Also show incoming links" desc="Links set on other notes, like “People” on an organisation.">
					<Toggle label="Also show incoming links" value={card.incoming !== false} onChange={(v) => setCard((c) => (c.incoming = v ? undefined : false))} />
				</Row>
				<Row label="Show empty fields" desc="List chosen fields even when they have no value.">
					<Toggle label="Show empty fields" value={!!card.showEmpty} onChange={(v) => setCard((c) => (c.showEmpty = v || undefined))} />
				</Row>
				<Row label="Links per row" desc="Before “+N more”.">
					<TextInput
						label="Links per row"
						className="oe-tm-narrow"
						value={card.maxChips === undefined ? "" : String(card.maxChips)}
						placeholder={String(DEFAULT_MAX_CHIPS)}
						onChange={(v) => {
							const n = Math.round(Number(v));
							setCard((c) => (c.maxChips = v.trim() && Number.isFinite(n) && n > 0 ? n : undefined));
						}}
					/>
				</Row>
			</Section>
		</div>
	);
}
