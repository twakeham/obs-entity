import { Notice } from "obsidian";
import type EntitiesPlugin from "../../../main";
import { asArray } from "../../../model/links";
import { formatValue, type FormatEnv } from "../../../model/fieldFormats";
import { fieldLabel, inScope, isBigRun, movedText, reachText, runReach, runsOnce, stepLabel, type FieldChange, type WorkflowDef } from "../../../model/workflows";
import type { EntityTypeDef } from "../../../model/types";
import type { TryRun } from "../../../services/workflows";
import { ReactModal } from "../../modals/bulkModals";
import { NotePickerModal } from "../../modals/workflowModals";
import { usePlugin } from "../context";
import { Icon } from "../Icon";

/** "Try on a note…": pick a note the workflow applies to, then show what it would do there (nothing is written). */
export function openTryRun(plugin: EntitiesPlugin, wf: WorkflowDef): void {
	const notes = plugin.index.all().filter((e) => inScope(wf, e.type));
	if (!notes.length) return void new Notice(wf.scope.length ? "There are no notes of these types to try it on." : "There are no notes to try it on.");
	new NotePickerModal(plugin.app, notes, `Try “${wf.name || "New workflow"}” on a note…`, (entity) => {
		const res = plugin.workflows.tryRun(wf, entity.path);
		if (!res) return void new Notice(`${entity.name} isn't an entity.`);
		new ReactModal(plugin, `Try “${wf.name || "New workflow"}”`, (close) => <TryRunResult wf={wf} res={res} again={() => (close(), openTryRun(plugin, wf))} close={close} />, "oe-wf-try-modal").open();
	}).open();
}

/** A value in words: links by their names, lists joined, empty as "empty". */
const plain = (v: unknown): string => {
	const items = asArray(v).map((x) => (typeof x === "string" ? x.replace(/^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/, (_m, target: string, alias?: string) => alias || target.split("/").pop()!) : typeof x === "object" ? JSON.stringify(x) : String(x)));
	return items.length ? items.join(", ") : "empty";
};

/** A field's value as the form shows it: dates, numbers and URLs in their display format, checkboxes as Yes / No. */
function shown(key: string, v: unknown, types: EntityTypeDef[], env: FormatEnv): string {
	const field = types.flatMap((t) => t.fields).find((f) => f.key === key);
	if (field?.kind === "boolean") return v === true || v === "true" ? "Yes" : v === false || v === "false" ? "No" : "empty";
	if (field && (field.kind === "date" || field.kind === "number" || field.kind === "url")) return formatValue(field, v, env) || "empty";
	return plain(v);
}

function Changes({ changes, types, created, quiet }: { changes: FieldChange[]; types: EntityTypeDef[]; created?: boolean; quiet?: boolean }) {
	const env = usePlugin().formatEnv();
	// A created note lists the values it starts with; others what changes.
	const list = created ? changes.filter((c) => asArray(c.after).length) : changes;
	if (!list.length) return quiet ? null : <div className="oe-tm-muted">{created ? "No fields set." : "No changes."}</div>;
	return (
		<table className="oe-wf-try-changes">
			<tbody>
				{list.map((c) => (
					<tr key={c.key}>
						<th>{fieldLabel(c.key, types)}</th>
						{!created && <td className="oe-wf-try-before">{shown(c.key, c.before, types, env)}</td>}
						{!created && <td className="oe-wf-try-arrow">→</td>}
						<td>{shown(c.key, c.after, types, env)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/** Where a moved or renamed note would go, or why it can't. */
function MoveLine({ move }: { move?: TryRun["moves"][number] }) {
	if (!move) return null;
	if (move.error) return <div className="oe-wf-try-move is-error">Can't move or rename it: {move.error}</div>;
	if (!move.to) return <div className="oe-wf-try-move oe-tm-muted">It's already where the step would put it.</div>;
	return (
		<div className="oe-wf-try-move">
			<Icon name="folder-input" /> {movedText(move.path, move.to)[0].toUpperCase() + movedText(move.path, move.to).slice(1)}
			<span className="oe-tm-muted"> ({move.to})</span>
		</div>
	);
}

/** What a test run found: problems, Only if, an error or stop, or every note it would change or create, its notices. */
export function TryRunResult({ wf, res, again, close }: { wf: WorkflowDef; res: TryRun; again: () => void; close: () => void }) {
	const plugin = usePlugin();
	const types = plugin.settings.types;
	const r = res.result;
	const t = wf.trigger;
	const reach = r && !r.error && !r.stopped ? runReach(r) : null;
	const others = r?.others.filter((o) => o.path !== res.row.path) ?? [];
	const moveOf = (path: string) => res.moves.find((m) => m.path === path);
	return (
		<div className="oe-wf-try">
			<div className="oe-wf-try-on">
				On <strong>{res.row.name}</strong> <span className="oe-tm-muted">({res.row.type.name})</span>
			</div>
			{res.problems.length > 0 && (
				<div className="oe-wf-try-banner is-error">
					<Icon name="alert-circle" />
					<div>
						It can't run until its problems are fixed:
						<ul>
							{res.problems.map((p, i) => (
								<li key={i}>{p}</li>
							))}
						</ul>
					</div>
				</div>
			)}
			{r && !res.passes && (
				<div className="oe-wf-try-banner">
					<Icon name="filter" /> {res.row.name} doesn't match Only if, so it wouldn't run there. If it did:
				</div>
			)}
			{r && t.kind === "changed" && <div className="oe-wf-help">As if {fieldLabel(t.field, types)} had just changed to what it is now: old() and new() both give the note as it is.</div>}
			{r && t.kind === "created" && <div className="oe-wf-help">As if the note had just been created.</div>}
			{r && runsOnce(wf) && <div className="oe-wf-help">It runs once for the whole selection: tried here as if {res.row.name} were the only note selected.</div>}
			{r?.stopped && (
				<div className="oe-wf-try-banner">
					<Icon name="octagon-x" /> It would stop: {r.stopped}
				</div>
			)}
			{r?.error && (
				<div className="oe-wf-try-banner is-error">
					<Icon name="alert-circle" /> Step {stepLabel(r.error.step)} would fail: {r.error.message} Nothing would be saved.
				</div>
			)}
			{r && reach && (
				<>
					{r.asked.map((q, i) => (
						<div key={i} className="oe-wf-try-banner is-ask">
							<Icon name="circle-check" /> It asks you to confirm “{q}” first. Taken as Yes here; No would stop the run.
						</div>
					))}
					{r.inputs.map((a, i) => (
						<div key={`i${i}`} className="oe-wf-try-banner is-ask">
							<Icon name="message-circle-question" /> It asks “{a.question}”. Taken as {a.answer ? `“${a.answer}” (its default answer)` : "an empty answer"} here.
						</div>
					))}
					<div className="oe-wf-try-note">
						<div className="oe-wf-try-title">{res.row.name}</div>
						<Changes changes={r.changes} types={types} quiet={!!moveOf(res.row.path)} />
						<MoveLine move={moveOf(res.row.path)} />
					</div>
					{others.map((o) => (
						<div key={o.path} className="oe-wf-try-note">
							<div className="oe-wf-try-title">
								{o.created ? <span className="oe-tm-badge is-new">new</span> : null} {o.name}
								<span className="oe-tm-muted"> · {o.path}</span>
							</div>
							<Changes changes={o.changes} types={types} created={!!o.created} quiet={!!moveOf(o.path)} />
							<MoveLine move={moveOf(o.path)} />
						</div>
					))}
					{r.notices.length > 0 && (
						<div className="oe-wf-try-note">
							<div className="oe-wf-try-title">Notices</div>
							{r.notices.map((n, i) => (
								<div key={i} className="oe-wf-try-notice">
									{n}
								</div>
							))}
						</div>
					)}
					{r.via.length > 0 && <div className="oe-wf-help">Also runs {r.via.map((v) => `“${v}”`).join(", ")}.</div>}
					<div className={`oe-wf-try-sum${isBigRun(reach) ? " is-big" : ""}`}>
						It would {reachText(reach)}.{isBigRun(reach) ? " That's a big run: it asks first when it runs for real." : ""}
					</div>
				</>
			)}
			<div className="oe-bulk-footer">
				<span className="oe-pop-hint">Nothing has been saved.</span>
				<span className="oe-spacer" />
				<button onClick={again}>Try another note…</button>
				<button className="mod-cta" onClick={close}>
					Close
				</button>
			</div>
		</div>
	);
}
