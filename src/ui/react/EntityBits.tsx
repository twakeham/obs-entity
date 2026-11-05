import { useState } from "react";
import type { PaletteColor } from "../../model/colors";
import { choicePillClass } from "../components/choicePicker";
import type { RelationGroup } from "../../model/relations";
import type { FieldDef } from "../../model/types";
import { EntityChip } from "./EntityChip";
import { Icon } from "./Icon";

const STATUS_TONES: Record<string, string> = {
	done: "done",
	complete: "done",
	completed: "done",
	won: "done",
	active: "active",
	open: "active",
	"in-progress": "active",
	customer: "active",
	"on-hold": "hold",
	blocked: "hold",
	lead: "hold",
	prospect: "hold",
	archived: "closed",
	abandoned: "closed",
	lost: "closed",
	inactive: "closed",
	former: "closed",
};

/** Colour family for a status word (draft/idea and unknown words are neutral). */
export function statusTone(status: string | null): string {
	return (status && STATUS_TONES[status.toLowerCase()]) || "neutral";
}

/** Classes for a value with a palette colour (none without one). */
export const colorClass = (c: PaletteColor | null | undefined): string => (c ? ` has-color oe-c-${c}` : "");

/** A status's colour classes: its set colour (group or type), else its tone by name. */
export const statusClass = (status: string | null, color: PaletteColor | null): string => (color ? `has-color oe-c-${color}` : `oe-tone-${statusTone(status)}`);

/** A group or swimlane heading's value: a choice field's value as its pill (in its colour), else the plain text. */
export function GroupValue({ col, text }: { col: { kind: string; field?: FieldDef } | null | undefined; text: string }) {
	const f = col?.field;
	return f && (f.kind === "select" || f.kind === "multiselect") ? <span className={choicePillClass(f.colors, text)}>{text}</span> : <>{text}</>;
}

/** Groups keyed by a link label ("Mentor", "Mentor of") already show the label as their title. */
const isLabelGroup = (g: RelationGroup) => g.key.startsWith("lab:") || g.key.startsWith("labin:");

const DIRECTION_ICON = { out: "arrow-right", in: "arrow-left", both: "arrow-left-right" } as const;
const DIRECTION_TITLE = { out: "Set on this note", in: "Set on the linked notes", both: "Works both ways" } as const;

/** Collapsible relationship groups with every chip, used by the Connections panel. */
export function RelationGroups({ groups, sourcePath, defaultCollapsed = [] }: { groups: RelationGroup[]; sourcePath: string; defaultCollapsed?: string[] }) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed));
	const toggle = (key: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	return (
		<div className="oe-groups">
			{groups.map((g) => {
				const isCollapsed = collapsed.has(g.key);
				return (
					<section key={g.key} className={`oe-group${isCollapsed ? " is-collapsed" : ""}`} data-group={g.key}>
						<div className="oe-group-header" onClick={() => toggle(g.key)}>
							<Icon name={isCollapsed ? "chevron-right" : "chevron-down"} className="oe-group-chevron" />
							<span className="oe-group-title">{g.title}</span>
							<span className="oe-group-count">{g.items.length}</span>
							<span className="oe-group-dir" aria-label={DIRECTION_TITLE[g.direction]}>
								<Icon name={DIRECTION_ICON[g.direction]} />
							</span>
						</div>
						{!isCollapsed && (
							<div className="oe-group-items">
								{g.items.map((item) => (
									<EntityChip key={`${item.direction}:${item.path ?? item.linktext}:${item.edge.label ?? ""}`} item={item} sourcePath={sourcePath} hideLabel={isLabelGroup(g)} />
								))}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}
