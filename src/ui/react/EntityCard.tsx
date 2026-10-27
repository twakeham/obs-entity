import { useState, type CSSProperties } from "react";
import { cardSections, DEFAULT_MAX_CHIPS } from "../../model/card";
import { usePlugin, useRelationsVersion } from "./context";
import { CardSectionsView, StatusSelect } from "./EntityBits";
import { Icon } from "./Icon";

/** Compact info card shown at the top of entity notes. What it shows comes from the type's `card` settings. */
export function EntityCard({ path }: { path: string }) {
	const plugin = usePlugin();
	useRelationsVersion();
	const [collapsed, setCollapsed] = useState(plugin.settings.cardCollapsed);
	const entity = plugin.index.get(path);
	if (!entity) return null;

	const sections = cardSections(entity.type, entity.frontmatter, plugin.relations.groupsFor(path), plugin.dates);
	const toggle = () => {
		const next = !collapsed;
		setCollapsed(next);
		plugin.settings.cardCollapsed = next;
		void plugin.saveData(plugin.settings);
	};

	return (
		<div className={`oe-card${collapsed ? " is-collapsed" : ""}`} style={{ "--oe-type-color": entity.type.color } as CSSProperties} data-entity-type={entity.type.key}>
			<div className="oe-card-top">
				<span className="oe-card-type">
					<Icon name={entity.type.icon} className="oe-chip-icon" />
					{entity.type.name}
				</span>
				<StatusSelect entity={entity} />
				{entity.subtitle ? (
					<span className="oe-card-subtitle" title={entity.subtitle}>
						{entity.subtitle}
					</span>
				) : (
					<span className="oe-card-spacer" />
				)}
				<span className="oe-card-actions">
					<a
						href="#"
						className="clickable-icon"
						aria-label="Open connections panel"
						onClick={(e) => {
							e.preventDefault();
							void plugin.activateConnectionsView();
						}}
					>
						<Icon name="waypoints" />
					</a>
					<a
						href="#"
						className="clickable-icon oe-card-collapse"
						aria-label={collapsed ? "Expand" : "Collapse"}
						onClick={(e) => {
							e.preventDefault();
							toggle();
						}}
					>
						<Icon name={collapsed ? "chevron-down" : "chevron-up"} />
					</a>
				</span>
			</div>
			{!collapsed && sections.length > 0 && (
				<div className="oe-card-body">
					<CardSectionsView sections={sections} sourcePath={path} max={entity.type.card?.maxChips ?? DEFAULT_MAX_CHIPS} />
				</div>
			)}
		</div>
	);
}
