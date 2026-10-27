import { TFile } from "obsidian";
import { useMemo, useState, type CSSProperties } from "react";
import type { RelationGroup } from "../../model/relations";
import { AddRelationModal } from "../modals/addRelationModal";
import { usePlugin, useRelationsVersion } from "./context";
import { RelationGroups } from "./EntityBits";
import { Icon } from "./Icon";

const MENTIONS_KEY = "mentions";

/** Connections panel: the active note's name and type, then all its relationships, grouped. */
export function ConnectionsPanel({ path }: { path: string | null }) {
	const plugin = usePlugin();
	const version = useRelationsVersion();
	const [filter, setFilter] = useState("");
	const file = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
	const entity = path ? plugin.index.get(path) : undefined;

	const { groups, total } = useMemo(() => {
		if (!path) return { groups: [] as RelationGroup[], total: 0 };
		const related = plugin.relations.groupsFor(path);
		const linked = new Set(related.flatMap((g) => g.items.map((i) => i.path).filter((p): p is string => !!p)));
		const mentions = plugin.relations.mentions(path, linked);
		const all: RelationGroup[] = mentions.length ? [...related, { key: MENTIONS_KEY, title: "Mentioned in", direction: "in", items: mentions }] : related;
		const q = filter.trim().toLowerCase();
		const filtered = q
			? all
					.map((g) => ({
						...g,
						items: g.items.filter((i) => {
							const name = (i.path ? (plugin.index.get(i.path)?.name ?? i.path) : i.linktext).toLowerCase();
							return name.includes(q) || g.title.toLowerCase().includes(q) || (i.edge.label ?? "").toLowerCase().includes(q);
						}),
					}))
					.filter((g) => g.items.length > 0)
			: all;
		return { groups: filtered, total: all.reduce((n, g) => n + g.items.length, 0) };
	}, [path, version, filter, plugin]);

	if (!path || !(file instanceof TFile)) {
		return <div className="oe-panel-empty">Open a note to see its connections.</div>;
	}

	return (
		<div className="oe-panel">
			<div className="oe-panel-header" style={entity ? ({ "--oe-type-color": entity.type.color } as CSSProperties) : undefined}>
				<Icon name={entity ? entity.type.icon : "file-text"} className="oe-type-icon oe-type-icon-lg" />
				<div className="oe-panel-title">
					<a
						href="#"
						className="oe-panel-name"
						onClick={(e) => {
							e.preventDefault();
							plugin.openPath(file.path, e.nativeEvent);
						}}
					>
						{entity?.name ?? file.basename}
					</a>
					<div className="oe-panel-meta">{entity ? entity.type.name : "Not an entity"}</div>
				</div>
			</div>

			<div className="oe-panel-toolbar">
				<input type="search" className="oe-panel-filter" placeholder={`Filter ${total} connection${total === 1 ? "" : "s"}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
				{entity ? (
					<button className="oe-panel-add" onClick={() => new AddRelationModal(plugin, entity).open()} aria-label="Add link">
						<Icon name="plus" /> Link
					</button>
				) : (
					<button className="oe-panel-add mod-cta" onClick={() => plugin.pickTypeAndConvert(file)}>
						Convert to entity
					</button>
				)}
			</div>

			{groups.length > 0 ? (
				<RelationGroups key={path} groups={groups} sourcePath={path} defaultCollapsed={[MENTIONS_KEY]} />
			) : (
				<div className="oe-panel-empty">{filter ? "No matches." : "No connections yet."}</div>
			)}
		</div>
	);
}
