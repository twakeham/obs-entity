import { Fragment, useState, type ReactNode } from "react";
import type { CardSection } from "../../model/card";
import type { RelationGroup } from "../../model/relations";
import { COMMON_KEYS, statusesFor } from "../../model/types";
import type { EntityRecord } from "../../services/entityIndex";
import { usePlugin } from "./context";
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

/** Status pill that edits the note's `status` frontmatter. */
export function StatusSelect({ entity }: { entity: EntityRecord }) {
	const plugin = usePlugin();
	const options = statusesFor(entity.type, plugin.settings.groups);
	const current = entity.status ?? "";
	const all = current && !options.includes(current) ? [current, ...options] : options;
	return (
		<select
			className={`oe-status dropdown oe-tone-${statusTone(current)}`}
			value={current}
			aria-label="Status"
			onChange={(e) => {
				const v = e.target.value;
				void plugin.app.fileManager.processFrontMatter(entity.file, (fm: Record<string, unknown>) => {
					fm[COMMON_KEYS.status] = v || null;
				});
			}}
		>
			{!current && <option value="">no status</option>}
			{all.map((s) => (
				<option key={s} value={s}>
					{s}
				</option>
			))}
		</select>
	);
}

/** Groups keyed by a link label ("Mentor", "Mentor of") already show the label as their title. */
const isLabelGroup = (g: RelationGroup) => g.key.startsWith("lab:") || g.key.startsWith("labin:");

/** One "Title: chip chip +3 more" row. */
function RelationRow({ group, sourcePath, max }: { group: RelationGroup; sourcePath: string; max: number }) {
	const [all, setAll] = useState(false);
	const shown = all ? group.items : group.items.slice(0, max);
	const more = group.items.length - shown.length;
	return (
		<div className="oe-row" data-group={group.key}>
			<span className="oe-row-title">{group.title}</span>
			<span className="oe-row-items">
				{shown.map((item) => (
					<EntityChip key={`${item.direction}:${item.path ?? item.linktext}:${item.edge.label ?? ""}`} item={item} sourcePath={sourcePath} hideLabel={isLabelGroup(group)} />
				))}
				{more > 0 && (
					<a
						href="#"
						className="oe-row-more"
						onClick={(e) => {
							e.preventDefault();
							setAll(true);
						}}
					>
						+{more} more
					</a>
				)}
			</span>
		</div>
	);
}

/** Card body: runs of field lines wrap together; relation groups are rows, in the order given. */
export function CardSectionsView({ sections, sourcePath, max }: { sections: CardSection[]; sourcePath: string; max: number }) {
	const blocks: ReactNode[] = [];
	let fields: CardSection[] = [];
	const flush = () => {
		if (!fields.length) return;
		const run = fields;
		blocks.push(
			<div key={`f${blocks.length}`} className="oe-card-fields">
				{run.map((f) =>
					f.kind === "field" ? (
						<span key={f.key} className={`oe-card-field${f.empty ? " is-empty" : ""}`} data-field={f.key}>
							<span className="oe-card-field-label">{f.label}</span>
							{f.href ? (
								<a className="oe-card-field-value external-link" href={f.href} target="_blank" rel="noopener">
									{f.value}
								</a>
							) : (
								<span className="oe-card-field-value">{f.value}</span>
							)}
						</span>
					) : null,
				)}
			</div>,
		);
		fields = [];
	};
	for (const s of sections) {
		if (s.kind === "field") {
			fields.push(s);
			continue;
		}
		flush();
		if (s.kind === "relation") blocks.push(<RelationRow key={`r:${s.group.key}`} group={s.group} sourcePath={sourcePath} max={max} />);
		else
			blocks.push(
				<div key={`e:${s.key}`} className="oe-row is-empty" data-group={s.key}>
					<span className="oe-row-title">{s.label}</span>
					<span className="oe-row-items oe-row-none">—</span>
				</div>,
			);
	}
	flush();
	return <Fragment>{blocks}</Fragment>;
}

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
