import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { describeRelationship, incomingRelations, newUid, relationshipField, targetName, type RelationshipSpec } from "../../../model/typeEditing";
import { toKey, type EntityTypeDef, type FieldDef, type GroupDef } from "../../../model/types";
import { Icon } from "../Icon";
import { Row, Section, Segmented, TargetPicker, TextInput, Toggle } from "./controls";
import { useEditor } from "./editor";

interface Node {
	id: string;
	name: string;
	icon: string;
	color?: string;
	typeKey?: string;
}
interface Link {
	node: string;
	labels: string[];
}

export function RelationshipsTab({ addRelationship }: { addRelationship: () => void }) {
	const { draft, allTypes, groups, openType, setTab, setFieldUid } = useEditor();
	const t = draft.type;
	const outgoing = t.fields.map((f, i) => ({ f, i })).filter((x) => x.f.kind === "relation");
	const incoming = useMemo(() => incomingRelations(t.key, t.group, allTypes), [t.key, t.group, allTypes]);
	const specific = incoming.filter((x) => !x.generic);
	const generic = incoming.filter((x) => x.generic);

	const openField = (i: number) => {
		setFieldUid(draft.meta[i].uid);
		setTab("fields");
	};

	return (
		<div className="oe-tm-rels">
			<Section
				title="Connections"
				desc="How this type links to the others. Arrows point from the note that holds the link."
				actions={
					<button className="mod-cta" onClick={addRelationship}>
						<Icon name="plus" /> Add relationship
					</button>
				}
			>
				<Diagram type={t} outgoing={outgoing.map((x) => x.f)} incoming={specific} types={allTypes} groups={groups} onOpen={(key) => key !== t.key && openType(key)} />
			</Section>

			<Section title={`Links from ${t.plural || t.name || "this type"}`} desc="Relation fields on this type.">
				{outgoing.length === 0 ? (
					<div className="oe-tm-empty">No relation fields yet.</div>
				) : (
					<div className="oe-tm-rellist">
						{outgoing.map(({ f, i }) => (
							<button key={draft.meta[i].uid} className="oe-tm-relrow" onClick={() => openField(i)}>
								<span className="oe-tm-relname">{f.label || "Untitled"}</span>
								<Icon name={f.symmetric ? "arrow-left-right" : "arrow-right"} className="oe-tm-muted" />
								<TargetChips targets={f.targets} types={allTypes} groups={groups} />
								<span className="oe-tm-relnote">
									{f.symmetric ? "reads both ways" : f.inverse ? <>shown there as “{f.inverse}”</> : "no name on the other side"}
									{f.labelled ? " · each link labelled" : f.multiple ? " · many" : " · one"}
								</span>
								<Icon name="chevron-right" className="oe-tm-muted" />
							</button>
						))}
					</div>
				)}
			</Section>

			<Section title={`Links to ${t.plural || t.name || "this type"}`} desc="Relation fields on other types that can point here. They appear on these notes under the name shown.">
				{specific.length === 0 ? (
					<div className="oe-tm-empty">No other type links here specifically.</div>
				) : (
					<div className="oe-tm-rellist">
						{specific.map(({ type, field }) => (
							<IncomingRow key={`${type.key}.${field.key}`} type={type} field={field} onOpen={() => openType(type.key, field.key)} />
						))}
					</div>
				)}
				{generic.length > 0 && (
					<details className="oe-tm-generic">
						<summary>
							{generic.length} more field{generic.length === 1 ? "" : "s"} can link to any entity{generic.some((g) => g.field.targets?.includes(`@${t.group}`)) ? ` or any ${groups.find((g) => g.key === t.group)?.name ?? t.group} entity` : ""}
						</summary>
						<div className="oe-tm-rellist">
							{generic.map(({ type, field }) => (
								<IncomingRow key={`${type.key}.${field.key}`} type={type} field={field} onOpen={() => openType(type.key, field.key)} />
							))}
						</div>
					</details>
				)}
			</Section>
		</div>
	);
}

function IncomingRow({ type, field, onOpen }: { type: EntityTypeDef; field: FieldDef; onOpen: () => void }) {
	return (
		<button className="oe-tm-relrow" onClick={onOpen}>
			<span className="oe-tm-chip is-type" style={{ "--oe-type-color": type.color } as CSSProperties}>
				<Icon name={type.icon} className="oe-chip-icon" />
				{type.name}
			</span>
			<span className="oe-tm-relname">{field.label}</span>
			<Icon name={field.symmetric ? "arrow-left-right" : "arrow-right"} className="oe-tm-muted" />
			<span className="oe-tm-relnote">shown here as “{field.symmetric ? field.inverse || field.label : field.inverse || `${field.label} (from ${type.name})`}”</span>
			<Icon name="chevron-right" className="oe-tm-muted" />
		</button>
	);
}

function TargetChips({ targets, types, groups }: { targets: string[] | undefined; types: EntityTypeDef[]; groups: GroupDef[] }) {
	const list = targets?.length ? targets : ["*"];
	return (
		<span className="oe-tm-targetchips">
			{list.map((k) => {
				const tt = types.find((x) => x.key === k);
				return (
					<span key={k} className="oe-tm-chip is-type" style={tt ? ({ "--oe-type-color": tt.color } as CSSProperties) : undefined}>
						<Icon name={tt?.icon ?? (k.startsWith("@") ? "folder" : "asterisk")} className="oe-chip-icon" />
						{targetName(k, types, false, groups)}
					</span>
				);
			})}
		</span>
	);
}

const NODE_H = 30;
const NODE_GAP = 12;

/** This type in the middle, types linking here on the left, types it links to on the right. */
function Diagram({
	type,
	outgoing,
	incoming,
	types,
	groups,
	onOpen,
}: {
	type: EntityTypeDef;
	outgoing: FieldDef[];
	incoming: { type: EntityTypeDef; field: FieldDef }[];
	types: EntityTypeDef[];
	groups: GroupDef[];
	onOpen: (key: string) => void;
}) {
	const nodeFor = (key: string): Node => {
		const t = types.find((x) => x.key === key);
		return t ? { id: key, name: t.name, icon: t.icon, color: t.color, typeKey: key } : { id: key, name: targetName(key, types, false, groups), icon: key.startsWith("@") ? "folder" : "asterisk" };
	};
	const right: Link[] = [];
	for (const f of outgoing) {
		for (const k of f.targets?.length ? f.targets : ["*"]) {
			const l = right.find((x) => x.node === k);
			if (l) l.labels.push(f.label);
			else right.push({ node: k, labels: [f.label] });
		}
	}
	const left: Link[] = [];
	for (const { type: src, field } of incoming) {
		const l = left.find((x) => x.node === src.key);
		if (l) l.labels.push(field.label);
		else left.push({ node: src.key, labels: [field.label] });
	}
	const rows = Math.max(1, left.length, right.length);
	const height = rows * (NODE_H + NODE_GAP) + 8;
	const box = useRef<HTMLDivElement>(null);
	const [w, setW] = useState(600);
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setW(el.clientWidth));
		ro.observe(el);
		setW(el.clientWidth);
		return () => ro.disconnect();
	}, []);

	const colW = Math.min(170, w * 0.24);
	const cx = w / 2;
	const yAt = (i: number, n: number) => height / 2 + (i - (n - 1) / 2) * (NODE_H + NODE_GAP);
	const center: Node = { id: type.key, name: type.name || "This type", icon: type.icon, color: type.color };

	const renderNode = (n: Node, x: number, y: number, side: "left" | "right" | "center") => (
		<button
			key={`${side}-${n.id}`}
			className={`oe-tm-node is-${side}${n.typeKey ? "" : " is-group"}`}
			style={{ left: x, top: y - NODE_H / 2, width: side === "center" ? colW + 20 : colW, height: NODE_H, "--oe-type-color": n.color ?? "var(--text-muted)" } as CSSProperties}
			onClick={() => n.typeKey && onOpen(n.typeKey)}
			disabled={!n.typeKey || side === "center"}
			title={n.typeKey && side !== "center" ? `Open ${n.name}` : undefined}
		>
			<Icon name={n.icon} className="oe-chip-icon" />
			<span>{n.name}</span>
		</button>
	);

	const centerL = cx - (colW + 20) / 2;
	const centerR = cx + (colW + 20) / 2;
	const leftX = 0;
	const rightX = w - colW;

	return (
		<div className="oe-tm-diagram" ref={box} style={{ height }}>
			<svg width={w} height={height} className="oe-tm-diagram-svg" aria-hidden="true">
				<defs>
					<marker id="oe-tm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
						<path d="M 0 0 L 10 5 L 0 10 z" />
					</marker>
				</defs>
				{left.map((l, i) => {
					const y = yAt(i, left.length);
					const x1 = leftX + colW;
					const mx = (x1 + centerL) / 2;
					return (
						<g key={`l${l.node}`}>
							<path d={`M ${x1} ${y} C ${mx} ${y}, ${mx} ${height / 2}, ${centerL - 2} ${height / 2}`} markerEnd="url(#oe-tm-arrow)" />
							<text x={x1 + 8} y={y - 6} textAnchor="start">
								{l.labels.join(" · ")}
							</text>
						</g>
					);
				})}
				{right.map((l, i) => {
					const y = yAt(i, right.length);
					const mx = (centerR + rightX) / 2;
					return (
						<g key={`r${l.node}`}>
							<path d={`M ${centerR} ${height / 2} C ${mx} ${height / 2}, ${mx} ${y}, ${rightX - 2} ${y}`} markerEnd="url(#oe-tm-arrow)" />
							<text x={rightX - 12} y={y - 6} textAnchor="end">
								{l.labels.join(" · ")}
							</text>
						</g>
					);
				})}
			</svg>
			{left.map((l, i) => renderNode(nodeFor(l.node), leftX, yAt(i, left.length), "left"))}
			{renderNode(center, centerL, height / 2, "center")}
			{right.map((l, i) => renderNode(nodeFor(l.node), rightX, yAt(i, right.length), "right"))}
			{left.length === 0 && <span className="oe-tm-diagram-none is-left">Nothing links here yet</span>}
			{right.length === 0 && <span className="oe-tm-diagram-none is-right">No links out yet</span>}
		</div>
	);
}

/** Guided dialog that creates a relation field. */
export function AddRelationshipDialog({ onClose }: { onClose: () => void }) {
	const { draft, update, allTypes, groups, setFieldUid, setTab } = useEditor();
	const t = draft.type;
	const [spec, setSpec] = useState<RelationshipSpec>({ label: "", targets: [], inverse: "", many: true, symmetric: false, labelled: false });
	const set = (p: Partial<RelationshipSpec>) => setSpec((s) => ({ ...s, ...p }));
	const key = toKey(spec.label);
	const clash = !!key && t.fields.some((f) => f.key === key);
	const ready = spec.label.trim() && spec.targets.length > 0;

	const create = () => {
		const uid = newUid();
		update((tt, meta) => {
			tt.fields.push(relationshipField(spec, tt.fields.map((f) => f.key)));
			meta.push({ uid, origKey: null });
		});
		setFieldUid(uid);
		setTab("fields");
		onClose();
	};

	return (
		<div className="oe-tm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="oe-tm-dialog" role="dialog" aria-label="Add relationship" onKeyDown={(e) => e.key === "Escape" && onClose()}>
				<div className="oe-tm-dialog-head">
					<h2>Add a relationship</h2>
					<button className="clickable-icon" aria-label="Close" onClick={onClose}>
						<Icon name="x" />
					</button>
				</div>
				<ol className="oe-tm-steps">
					<li>
						<Row label={`What can a ${t.name.toLowerCase() || "note"} link to?`} stacked>
							<TargetPicker values={spec.targets} types={allTypes} groups={groups} onChange={(v) => set({ targets: v })} />
						</Row>
					</li>
					<li>
						<Row label="What's the link called here?" desc={clash ? `This type already has a “${key}” field; the new one will get a numbered key.` : "E.g. “Works for”, “Client”, “Located in”."} stacked>
							<TextInput label="Relationship name" autoFocus value={spec.label} placeholder="e.g. Works for" onChange={(v) => set({ label: v })} />
						</Row>
					</li>
					<li>
						<Row label="What's it called on the other note?" desc={spec.symmetric ? "Optional for links that read both ways." : "E.g. “People” for “Works for”. Leave empty to show the name above."} stacked>
							<TextInput label="Name on the other note" value={spec.inverse} placeholder={spec.symmetric ? spec.label || "Same name" : "e.g. People"} onChange={(v) => set({ inverse: v })} />
						</Row>
					</li>
					<li>
						<div className="oe-tm-dialog-options">
							<Row label="How many?">
								<Segmented
									label="How many"
									value={spec.many || spec.labelled ? "many" : "one"}
									disabled={spec.labelled}
									options={[
										{ value: "one", label: "One" },
										{ value: "many", label: "Many" },
									]}
									onChange={(v) => set({ many: v === "many" })}
								/>
							</Row>
							<Row label="Reads both ways" desc="Like partners.">
								<Toggle label="Reads both ways" value={spec.symmetric} onChange={(v) => set({ symmetric: v })} />
							</Row>
							<Row label="Each link has its own label" desc="Like mentor or client.">
								<Toggle label="Each link has its own label" value={spec.labelled} onChange={(v) => set({ labelled: v })} />
							</Row>
						</div>
					</li>
				</ol>
				<div className="oe-tm-sentence">
					<Icon name="info" /> {describeRelationship(spec, t.name || "note", allTypes, groups)}
				</div>
				<div className="oe-tm-dialog-foot">
					<button onClick={onClose}>Cancel</button>
					<button className="mod-cta" disabled={!ready} onClick={create}>
						Add relationship
					</button>
				</div>
			</div>
		</div>
	);
}
