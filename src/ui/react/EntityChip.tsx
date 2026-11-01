import { Menu, TFile } from "obsidian";
import type { CSSProperties, MouseEvent } from "react";
import type { RelationItem } from "../../model/relations";
import { usePlugin } from "./context";
import { Icon } from "./Icon";

export const HOVER_SOURCE = "obs-entities";

/** Clickable chip for the other end of a relationship. Labelled links show their label after the name, unless the group already is the label. `onRemove` adds a × inside the chip. */
export function EntityChip({ item, sourcePath, hideLabel = false, onRemove, removeLabel }: { item: RelationItem; sourcePath: string; hideLabel?: boolean; onRemove?: () => void; removeLabel?: string }) {
	const plugin = usePlugin();
	const { app } = plugin;
	const entity = item.path ? plugin.index.get(item.path) : undefined;
	const file = item.path ? app.vault.getAbstractFileByPath(item.path) : null;
	const unresolved = !item.path || !(file instanceof TFile);
	const name = entity?.name ?? (file instanceof TFile ? file.basename : (item.linktext.split("/").pop() ?? item.linktext));
	const style = entity ? ({ "--oe-type-color": entity.type.color } as CSSProperties) : undefined;
	const label = !hideLabel && item.edge.labelled && item.edge.label ? item.edge.label : null;

	const open = (evt: MouseEvent) => {
		evt.preventDefault();
		if (unresolved) plugin.createFromUnresolved(item.linktext, item.edge.targets);
		else plugin.openPath(item.path!, evt.nativeEvent);
	};

	const hover = (evt: MouseEvent) => {
		if (unresolved) return;
		app.workspace.trigger("hover-link", {
			event: evt.nativeEvent,
			source: HOVER_SOURCE,
			hoverParent: { hoverPopover: null },
			targetEl: evt.currentTarget,
			linktext: item.path,
			sourcePath,
		});
	};

	const menu = (evt: MouseEvent) => {
		evt.preventDefault();
		const m = new Menu();
		if (!unresolved) {
			m.addItem((i) => i.setSection("open").setTitle("Open in new tab").setIcon("file-plus").onClick(() => plugin.openPath(item.path!, "tab")));
			m.addItem((i) => i.setSection("open").setTitle("Open to the right").setIcon("separator-vertical").onClick(() => plugin.openPath(item.path!, "split")));
		} else {
			m.addItem((i) => i.setSection("open").setTitle(`Create "${name}"`).setIcon("plus").onClick(() => plugin.createFromUnresolved(item.linktext, item.edge.targets)));
		}
		if (item.edge.fieldKey) {
			const owner = item.edge.source === sourcePath ? "" : ` (edits ${app.vault.getAbstractFileByPath(item.edge.source)?.name.replace(/\.md$/, "") ?? "source"})`;
			m.addItem((i) =>
				i
					.setSection("danger")
					.setTitle(`Remove link${owner}`)
					.setIcon("unlink")
					.setWarning(true)
					.onClick(() => void plugin.factory.removeRelation(item.edge)),
			);
		}
		if (file instanceof TFile) app.workspace.trigger("file-menu", m, file, "obs-entities-chip");
		m.showAtMouseEvent(evt.nativeEvent);
	};

	return (
		<a
			className={`oe-chip oe-chip-link${unresolved ? " is-unresolved" : ""}`}
			style={style}
			href="#"
			title={unresolved ? `"${name}" doesn't exist yet. Click to create it.` : entity?.subtitle || undefined}
			onClick={open}
			onAuxClick={(e) => e.button === 1 && !unresolved && plugin.openPath(item.path!, "tab")}
			onMouseOver={hover}
			onContextMenu={menu}
			data-path={item.path ?? undefined}
		>
			{entity ? <Icon name={entity.type.icon} className="oe-chip-icon" /> : <Icon name={unresolved ? "file-question" : "file-text"} className="oe-chip-icon" />}
			<span className="oe-chip-text">{name}</span>
			{label && <span className="oe-chip-note">· {label}</span>}
			{onRemove && (
				<span
					className="oe-chip-remove"
					role="button"
					aria-label={removeLabel ?? `Remove ${name}`}
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onRemove();
					}}
				>
					<Icon name="x" />
				</span>
			)}
		</a>
	);
}
