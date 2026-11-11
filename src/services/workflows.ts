import { Events, Notice, TFile, TFolder, debounce, normalizePath } from "obsidian";
import { emptyFormValues } from "../model/defaults";
import { todayDays } from "../model/formConditions";
import type { EntityFormValues } from "../model/frontmatter";
import { joinPath, sanitizeFileName, uniquePath } from "../model/paths";
import { askQuestion, confirmRun } from "../ui/modals/workflowModals";
import { COMMON_KEYS } from "../model/types";
import type { ViewContext, ViewRow } from "../model/views";
import {
	changeMatches,
	inScope,
	isBigRun,
	MAX_CHAIN,
	passesWhen,
	reachText,
	runReach,
	runSteps,
	workflowProblems,
	type FieldChange,
	type NoteMove,
	type Placed,
	type PlaceRequest,
	type RunResult,
	type TriggerKind,
	type WorkflowDef,
} from "../model/workflows";
import type EntitiesPlugin from "../main";
import type { EntityRecord } from "./entityIndex";

/** One run, as the log keeps it. */
export interface RunRecord {
	id: string;
	time: number;
	workflow: string;
	name: string;
	path: string;
	note: string;
	trigger: TriggerKind;
	changes: FieldChange[];
	notices: string[];
	error?: string;
	/** why a chain stopped here (the run didn't happen) */
	stopped?: string;
	undone?: boolean;
	/** the run that started this chain (this run's changes set off by it, directly or not) */
	root?: string;
	/** notes the run created */
	created?: { path: string; name: string }[];
	/** other existing notes it changed (linked notes, "Use the existing one"), with their changes */
	others?: { path: string; name: string; changes: FieldChange[] }[];
	/** workflows it ran ("Run another workflow") */
	via?: string[];
	/** questions it asked, answered Yes */
	asked?: string[];
	/** notes it moved or renamed: old path → new path */
	moved?: { from: string; to: string }[];
}

/** A selection run one note at a time: whether a big run was agreed to, answers kept for the rest, notes still to go. */
interface Batch {
	agreed: boolean;
	answers: Map<number, boolean>;
	left: number;
}

/** What "Try on a note…" found: the workflow's problems (then no result), whether the note matches Only if, and what the steps would do. */
export interface TryRun {
	row: ViewRow;
	problems: string[];
	passes: boolean;
	result: RunResult | null;
	/** where moved and renamed notes would go (null: they'd stay put), or why they can't */
	moves: { path: string; to: string | null; error?: string }[];
}

/** Runs caused by one change, and the ones they cause in turn. */
interface Chain {
	depth: number;
	/** "<workflow id>|<path>" already run in this chain */
	seen: Set<string>;
	/** the first run in the chain that changed something */
	root?: string;
}

/** How long a tag on a written note waits for the index to report the write. */
const TAG_MS = 5000;
const LOG_LIMIT = 200;
const fresh = (): Chain => ({ depth: 0, seen: new Set() });
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The workflow engine (DESIGN §8.11): runs workflows when notes are created or change (from the index's per-note
 * events) and when someone runs them on notes. Writes each changed note once, tags its writes so the changes they
 * cause carry the chain (5 deep, a workflow once per note), keeps undo for every run and a log of the last 200.
 * Emits "log" when the log changes.
 */
export class WorkflowEngine extends Events {
	log: RunRecord[] = [];
	private undos = new Map<string, () => Promise<boolean>>();
	/**
	 * Writes waiting for the index to report them, by path, oldest first (one entry per write): a run's (its chain
	 * continues) or an undo's (silent: no workflows).
	 */
	private writes = new Map<string, { chain: Chain | null; until: number }[]>();
	/** notes runs just created: their first metadata re-reads aren't edits (no "When changed" from them) */
	private justCreated = new Map<string, number>();
	/** runs in progress, so their own index events wait their turn */
	private queue: Promise<unknown> = Promise.resolve();
	private saveLog = debounce(() => void this.writeLog(), 1000, true);

	constructor(private plugin: EntitiesPlugin) {
		super();
	}

	load(): void {
		const { index } = this.plugin;
		this.plugin.registerEvent(index.on("entity-created", (...a: unknown[]) => this.enqueue(() => this.onCreated(a[0] as EntityRecord))));
		this.plugin.registerEvent(index.on("entity-changed", (...a: unknown[]) => this.enqueue(() => this.onChanged(a[0] as EntityRecord, a[1] as Record<string, unknown>))));
		// A run that writes a note and then moves it: the write's change event comes under the new path.
		this.plugin.registerEvent(
			this.plugin.app.vault.on("rename", (file, oldPath) => {
				for (const map of [this.writes, this.justCreated] as Map<string, unknown>[]) {
					if (!map.has(oldPath)) continue;
					map.set(file.path, map.get(oldPath));
					map.delete(oldPath);
				}
			}),
		);
		void this.readLog();
	}

	get paused(): boolean {
		return this.plugin.settings.workflowsPaused;
	}

	async setPaused(paused: boolean): Promise<void> {
		this.plugin.settings.workflowsPaused = paused;
		await this.plugin.saveData(this.plugin.settings);
		this.trigger("log");
	}

	/** Workflows that can be run on a note (manual ones in scope, switched on). */
	manualFor(rec: EntityRecord | undefined): WorkflowDef[] {
		if (!rec) return [];
		return this.plugin.settings.workflows.filter((w) => w.on && w.trigger.kind === "manual" && inScope(w, rec.type));
	}

	private enqueue(task: () => Promise<unknown>): void {
		this.queue = this.queue.then(task).catch((e) => console.error("Obsidian Entities: workflow failed", e));
	}

	/** Expect a write's change event: a run's (`chain`) or an undo's (null). */
	private expectWrite(path: string, chain: Chain | null): void {
		const list = this.writes.get(path) ?? [];
		list.push({ chain, until: Date.now() + TAG_MS });
		this.writes.set(path, list);
	}

	/** A change event: was it an undo's write (no workflows), or a run's (its chain continues)? Else a new chain. */
	private takeTag(path: string): { silent: boolean; chain: Chain } {
		const now = Date.now();
		const list = this.writes.get(path);
		while (list?.length) {
			const w = list.shift()!;
			if (!list.length) this.writes.delete(path);
			if (w.until <= now) continue;
			return w.chain ? { silent: false, chain: w.chain } : { silent: true, chain: fresh() };
		}
		return { silent: false, chain: fresh() };
	}

	private async onCreated(rec: EntityRecord): Promise<void> {
		const { silent, chain } = this.takeTag(rec.path);
		if (silent || this.paused) return;
		for (const wf of this.plugin.settings.workflows)
			if (wf.on && wf.trigger.kind === "created" && inScope(wf, rec.type) && wf.scope.length) await this.run(wf, rec.path, { chain });
	}

	private async onChanged(rec: EntityRecord, before: Record<string, unknown>): Promise<void> {
		// Body edits re-read the metadata too: only frontmatter changes count (and they consume the tag).
		if (same(before, rec.frontmatter)) return;
		// A note a run just created being read for the first time (the template merged in) isn't an edit.
		const born = this.justCreated.get(rec.path);
		if (born !== undefined) {
			if (born > Date.now() && !this.writes.get(rec.path)?.length) return;
			if (born <= Date.now()) this.justCreated.delete(rec.path);
		}
		const { silent, chain } = this.takeTag(rec.path);
		if (silent || this.paused) return;
		for (const wf of this.plugin.settings.workflows) {
			const t = wf.trigger;
			if (!wf.on || t.kind !== "changed" || !wf.scope.length || !inScope(wf, rec.type) || !changeMatches(t, before, rec.frontmatter, rec.type)) continue;
			await this.run(wf, rec.path, { chain, before });
		}
	}

	/** Run a workflow on notes by hand: one run each, then a notice with Undo. */
	async runOn(wf: WorkflowDef, paths: string[]): Promise<RunRecord[]> {
		if (this.paused) {
			new Notice("Workflows are paused.");
			return [];
		}
		const problems = workflowProblems(wf, this.plugin.settings);
		if (problems.length) {
			new Notice(`“${wf.name}” can't run: ${problems[0].message}`);
			return [];
		}
		const done: RunRecord[] = [];
		// Agreeing to one big run agrees to the rest of the selection's; an answer can be kept for the rest too.
		const batch: Batch = { agreed: false, answers: new Map(), left: 0 };
		for (const [i, p] of paths.entries()) {
			batch.left = paths.length - i - 1;
			const r = await new Promise<RunRecord | null>((resolve) => this.enqueue(async () => resolve(await this.run(wf, p, { chain: fresh(), manual: true, batch }))));
			if (r) done.push(r);
		}
		const changed = done.filter((r) => (r.changes.length || r.created?.length || r.others?.length || r.moved?.length) && !r.error);
		const failed = done.filter((r) => r.error || r.stopped);
		if (changed.length || !failed.length) {
			const made = changed.flatMap((r) => r.created ?? []);
			// Notes changed (not created): each run's own note, if it changed or moved, and the other notes it changed or moved.
			const edited = changed.flatMap((r) => {
				const names = new Set<string>();
				if (r.changes.length || r.moved?.some((m) => m.from === r.path)) names.add(r.path);
				for (const o of r.others ?? []) names.add(o.path);
				for (const m of r.moved ?? []) names.add(m.from);
				return [...names].map((p) => (p === r.path ? r.note : (r.others?.find((o) => o.path === p)?.name ?? (p.split("/").pop() ?? p).replace(/\.md$/, ""))));
			});
			const frag = createFragment((f) => {
				const parts = [
					...(made.length ? [`created ${made.length === 1 ? made[0].name : `${made.length} notes`}`] : []),
					...(edited.length ? [`changed ${edited.length === 1 ? edited[0] : `${edited.length} notes`}`] : []),
				];
				f.appendText(parts.length ? `“${wf.name}” ${parts.join(" and ")}.` : `“${wf.name}” made no changes.`);
				if (changed.length) {
					f.appendText(" ");
					const a = f.createEl("a", { text: "Undo", href: "#" });
					a.addEventListener("click", (e) => {
						e.preventDefault();
						void this.undo(changed.map((r) => r.id));
					});
				}
			});
			new Notice(frag, 8000);
		}
		return done;
	}

	/**
	 * Run one workflow on one note: check problems, the chain and Only if, run the steps, write the note once, keep
	 * its undo and log it. Null when it didn't apply (Only if failed).
	 */
	private async run(wf: WorkflowDef, path: string, opts: { chain: Chain; before?: Record<string, unknown>; manual?: boolean; batch?: Batch }): Promise<RunRecord | null> {
		const { plugin } = this;
		const { app } = plugin;
		const file = app.vault.getAbstractFileByPath(path);
		const rec = plugin.index.get(path);
		if (!(file instanceof TFile) || !rec) return null;
		const base = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, time: Date.now(), workflow: wf.id, name: wf.name, path, note: rec.name, trigger: wf.trigger.kind, changes: [], notices: [] };
		const problems = workflowProblems(wf, plugin.settings);
		if (problems.length) return this.record({ ...base, error: `The workflow has problems: ${problems[0].message}` });
		const key = `${wf.id}|${path}`;
		if (opts.chain.seen.has(key)) return this.record({ ...base, stopped: "It already ran on this note in this chain of changes." });
		if (opts.chain.depth >= MAX_CHAIN) return this.record({ ...base, stopped: `Stopped after ${MAX_CHAIN} workflows set each other off.` });
		let res: RunResult;
		const answers = new Set<number>();
		for (let agreed = false; ; ) {
			const { rows, ctx } = plugin.viewData();
			const row = rows.find((r) => r.path === path);
			if (!row) return null;
			const old: ViewRow | undefined = opts.before ? { ...row, frontmatter: opts.before, status: typeof opts.before[COMMON_KEYS.status] === "string" ? (opts.before[COMMON_KEYS.status] as string) : null } : undefined;
			const replanned = agreed || answers.size > 0;
			if (!passesWhen(wf, row, ctx)) return replanned ? this.record({ ...base, stopped: "The note no longer matched Only if." }) : null;
			res = this.simulate(wf, row, rows, ctx, old, answers);
			if (res.stopped) {
				if (opts.manual) new Notice(`“${wf.name}” stopped: ${res.stopped}`);
				return this.record({ ...base, stopped: res.stopped });
			}
			if (res.error) {
				new Notice(`Workflow “${wf.name}” stopped on ${rec.name}: ${res.error.message}`);
				return this.record({ ...base, error: `Step ${res.error.step + 1}: ${res.error.message}` });
			}
			if (res.pending) {
				const { step, text } = res.pending;
				let yes = opts.batch?.answers.get(step);
				if (yes === undefined) {
					const a = await askQuestion(app, `${wf.name} · ${rec.name}`, text, opts.batch?.left ?? 0);
					yes = a.yes;
					if (a.all && opts.batch) opts.batch.answers.set(step, yes);
				}
				if (!yes) return this.record({ ...base, stopped: `Answered No: “${text}”` });
				// Notes may have changed while the question was open: plan again from them, with this answer.
				answers.add(step);
				continue;
			}
			const reach = runReach(res);
			if (agreed || !isBigRun(reach) || opts.batch?.agreed) break;
			if (!(await confirmRun(app, `Run “${wf.name}”?`, `On ${rec.name}, it would ${reachText(reach)}. You can undo it afterwards.`))) return this.record({ ...base, stopped: `Cancelled: it would ${reachText(reach)}.` });
			if (opts.batch) opts.batch.agreed = true;
			// Plan again from the notes as they are now, so nothing newer is overwritten.
			agreed = true;
		}
		for (const n of res.notices) new Notice(n);
		const made = res.others.filter((o) => o.created);
		const edited = res.others.filter((o) => !o.created && o.changes.length);
		const moving = this.moving(path, res);
		const record: RunRecord = {
			...base,
			changes: res.changes,
			notices: res.notices,
			...(opts.chain.root ? { root: opts.chain.root } : {}),
			...(made.length ? { created: made.map((o) => ({ path: o.path, name: o.name })) } : {}),
			...(edited.length ? { others: edited.map((o) => ({ path: o.path, name: o.name, changes: o.changes })) } : {}),
			...(res.via.length ? { via: res.via } : {}),
			...(res.asked.length ? { asked: res.asked } : {}),
		};
		if (res.changes.length || made.length || edited.length || moving.length) {
			const chain: Chain = { depth: opts.chain.depth + 1, seen: new Set([...opts.chain.seen, key]), root: opts.chain.root ?? record.id };
			// Created notes, in the order the steps made them, each kept for undo as it was written.
			const createdFiles: { path: string; content: string }[] = [];
			const moved: { from: string; to: string }[] = [];
			try {
				for (const o of made) {
					const type = plugin.getType(o.created!.type);
					if (!type) throw new Error(`“${o.created!.type}” isn't a type.`);
					this.expectWrite(o.path, chain);
					this.justCreated.set(o.path, Date.now() + TAG_MS);
					const values = emptyFormValues(type, plugin.settings.groups, o.name, { today: todayDays(), dates: plugin.dates });
					const file = await plugin.factory.createEntity(type, values, { open: false, path: o.path, frontmatter: o.fm, template: o.created!.template });
					createdFiles.push({ path: file.path, content: "" });
				}
				if (res.changes.length) await this.write(path, res.changes, chain);
				for (const o of edited) await this.write(o.path, o.changes, chain);
				// Moves and renames last, once the notes are written (a parent link a step set can decide the folder).
				const taken = new Set<string>();
				for (const m of moving) {
					const to = this.destination(m.path, m.fm, m.move, taken);
					if (!to) continue;
					await this.relocate(m.path, to);
					moved.push({ from: m.path, to });
				}
			} catch (e) {
				return this.record({ ...base, ...(moved.length ? { moved } : {}), error: `Couldn't save: ${(e as Error).message}` });
			}
			if (moved.length) record.moved = moved;
			for (const c of createdFiles) {
				const f = app.vault.getAbstractFileByPath(c.path);
				if (f instanceof TFile) c.content = await app.vault.read(f);
			}
			this.undos.set(record.id, async () => {
				let ok = true;
				// Back where they were first, so the fields are put back at their old paths.
				for (const m of [...moved].reverse()) ok = (await this.moveBack(m.from, m.to)) && ok;
				if (res.changes.length) ok = (await this.restore(path, res.changes)) && ok;
				for (const o of edited) ok = (await this.restore(o.path, o.changes)) && ok;
				for (const c of [...createdFiles].reverse()) ok = (await this.removeCreated(c.path, c.content)) && ok;
				return ok;
			});
			// A run set off by an edit is one Ctrl/Cmd+Z step where the edit was made (the form, a table cell).
			const at = moved.find((m) => m.from === path)?.to ?? path;
			if (opts.before) plugin.formHistory.push(at, { key: "", before: undefined, after: undefined, undo: () => this.undo([record.id]) });
			for (const o of made) {
				const f = app.vault.getAbstractFileByPath(o.path);
				if (f instanceof TFile && o.created!.open !== "no") await app.workspace.getLeaf(o.created!.open === "tab" ? "tab" : false).openFile(f);
			}
		}
		return this.record(record);
	}

	/** The existing notes a run moves or renames (this note first), with their planned frontmatter. */
	private moving(path: string, res: RunResult): { path: string; fm: Record<string, unknown>; move: NoteMove }[] {
		return [...(res.move ? [{ path, fm: res.fm, move: res.move }] : []), ...res.others.filter((o) => !o.created && o.move).map((o) => ({ path: o.path, fm: o.fm, move: o.move! }))];
	}

	/**
	 * Where a move or rename puts a note: the folder (as given, or by its type's folder rules from its planned
	 * frontmatter; else where it is) and the name (new, or its own). A note already there gets " 2", " 3"… Null
	 * when it stays where it is. `taken`: paths (lower case) other moves in the run go to.
	 */
	private destination(path: string, fm: Record<string, unknown>, move: NoteMove, taken: Set<string>): string | null {
		const { app, factory, index } = this.plugin;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`${path} is missing.`);
		const base = move.name !== undefined ? sanitizeFileName(move.name) : file.basename;
		if (!base) throw new Error(`“${move.name}” can't be a note's name.`);
		let folder: string;
		if (move.byType) {
			const type = index.get(path)?.type;
			if (!type) throw new Error(`${file.basename} isn't an entity, so it has no folder rules.`);
			folder = factory.folderFor(type, { name: base, status: "", tags: [], fields: fm as EntityFormValues["fields"] });
		} else if (move.folder !== undefined) folder = factory.matchExistingCase(move.folder);
		else folder = file.parent && !file.parent.isRoot() ? file.parent.path : "";
		const there = folder ? app.vault.getAbstractFileByPath(folder) : app.vault.getRoot();
		const inFolder = there instanceof TFolder ? there.children : [];
		const isTaken = (p: string) => p.toLowerCase() !== path.toLowerCase() && (taken.has(p.toLowerCase()) || inFolder.some((c) => c.path.toLowerCase() === p.toLowerCase()));
		const to = normalizePath(uniquePath(folder, base, isTaken));
		if (to === path) return null;
		taken.add(to.toLowerCase());
		return to;
	}

	/** Move or rename a note (links to it follow, as Obsidian's settings say), making its folder if needed. */
	private async relocate(from: string, to: string): Promise<void> {
		const { app, factory } = this.plugin;
		const file = app.vault.getAbstractFileByPath(from);
		if (!(file instanceof TFile)) throw new Error(`${from} is missing.`);
		await factory.ensureFolder(to.split("/").slice(0, -1).join("/"));
		await app.fileManager.renameFile(file, to);
	}

	/** Undo a move: back to its old path, if it's still where the run put it and nothing has taken its old place. */
	private async moveBack(from: string, to: string): Promise<boolean> {
		const { app } = this.plugin;
		if (!(app.vault.getAbstractFileByPath(to) instanceof TFile) || app.vault.getAbstractFileByPath(from)) return false;
		await this.relocate(to, from);
		return true;
	}

	/** What a workflow's steps would do on a note: worked out on copies, nothing written. */
	private simulate(wf: WorkflowDef, row: ViewRow, rows: ViewRow[], ctx: ViewContext, old?: ViewRow, answers?: Set<number> | "all"): RunResult {
		const { app } = this.plugin;
		const linkText = (p: string) => {
			const target = app.vault.getAbstractFileByPath(p);
			if (target instanceof TFile) return app.metadataCache.fileToLinktext(target, row.path, true);
			// A note this run creates: its name, unless another note already goes by it.
			const name = p.replace(/\.md$/, "").split("/").pop() ?? p;
			return app.metadataCache.getFirstLinkpathDest(name, row.path) ? p.replace(/\.md$/, "") : name;
		};
		return runSteps(wf, { ctx, row, old, linkText, place: this.placer(rows), workflows: this.plugin.settings.workflows, answers });
	}

	/**
	 * "Try on a note…": what a workflow (saved, or a draft) would do on a note, writing nothing. The steps are worked
	 * out even when the note doesn't match Only if (`passes` says so). Null when the note isn't an entity.
	 */
	tryRun(wf: WorkflowDef, path: string): TryRun | null {
		const { rows, ctx } = this.plugin.viewData();
		const row = rows.find((r) => r.path === path);
		if (!row) return null;
		const problems = workflowProblems(wf, this.plugin.settings).map((p) => p.message);
		if (problems.length) return { row, problems, passes: false, result: null, moves: [] };
		// Questions are taken as answered Yes, to show everything the run would do.
		const result = this.simulate(wf, row, rows, ctx, undefined, "all");
		const taken = new Set<string>();
		const moves = result.error || result.stopped ? [] : this.moving(path, result).map((m) => {
			try {
				return { path: m.path, to: this.destination(m.path, m.fm, m.move, taken) };
			} catch (e) {
				return { path: m.path, to: null, error: (e as Error).message };
			}
		});
		return { row, problems, passes: passesWhen(wf, row, ctx), result, moves };
	}

	/** Write a run's field changes to a note (tagged with the chain, so the changes it causes continue it). */
	private async write(path: string, changes: FieldChange[], chain: Chain): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`${path} is missing.`);
		this.expectWrite(path, chain);
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				for (const c of changes) {
					if (c.after === undefined) delete fm[c.key];
					else fm[c.key] = copy(c.after);
				}
			});
		} catch (e) {
			this.writes.get(path)?.pop();
			throw e;
		}
	}

	/**
	 * Where "Create a note" puts a note: the type's folder (by its rules, with the parent link the step sets), under
	 * its name. A same-named note of the same type there is "existing" (reused or a stop, as the step says); other
	 * clashes get " 2", " 3"…
	 */
	private placer(rows: ViewRow[]): (req: PlaceRequest) => Placed {
		const { app, factory, index } = this.plugin;
		return (req) => {
			const values = { name: req.name, status: "", tags: [], fields: req.fm as EntityFormValues["fields"] };
			const folder = factory.folderFor(req.type, values);
			const base = sanitizeFileName(req.name);
			if (!base) return { stop: `“${req.name}” can't be a note's name.` };
			const folderObj = folder ? app.vault.getAbstractFileByPath(folder) : app.vault.getRoot();
			const inFolder = folderObj instanceof TFolder ? folderObj.children.filter((c): c is TFile => c instanceof TFile) : [];
			const taken = (p: string) => req.taken.has(p.toLowerCase()) || inFolder.some((f) => f.path.toLowerCase() === p.toLowerCase());
			const at = normalizePath(joinPath(folder, `${base}.md`));
			const same = inFolder.find((f) => f.path.toLowerCase() === at.toLowerCase());
			const rec = same ? index.get(same.path) : undefined;
			if (rec && rec.type.key === req.type.key) {
				if (req.exists === "stop") return { stop: `${rec.name} already exists.` };
				if (req.exists === "use") {
					const existing = rows.find((r) => r.path === rec.path);
					if (existing) return { path: rec.path, existing };
				}
			}
			return { path: normalizePath(uniquePath(folder, base, taken)) };
		};
	}

	/** Undo a created note: delete it (to the trash, as the vault is set up), asking first if it changed since. */
	private async removeCreated(path: string, content: string): Promise<boolean> {
		const { app } = this.plugin;
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return true;
		if ((await app.vault.read(file)) !== content && !(await confirmRun(app, `Delete “${file.basename}”?`, "The workflow created this note, and it has changed since. Undoing the run deletes it.", "Delete"))) return false;
		await app.fileManager.trashFile(file);
		return true;
	}
	/** Put a run's changed fields back, where they haven't changed since. Undo writes don't trigger workflows. */
	private async restore(path: string, changes: FieldChange[]): Promise<boolean> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;
		let skipped = false;
		let wrote = false;
		this.expectWrite(path, null);
		await this.plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			for (const c of changes) {
				if (!same(fm[c.key], c.after)) {
					skipped = true;
					continue;
				}
				wrote = true;
				if (c.before === undefined) delete fm[c.key];
				else fm[c.key] = copy(c.before);
			}
		});
		// Nothing put back: no write, so no change event will come for it.
		if (!wrote) this.writes.get(path)?.pop();
		return !skipped;
	}

	/** Undo runs, with the runs they set off (newest first). */
	async undo(ids: string[]): Promise<void> {
		let skipped = false;
		let n = 0;
		// The log is newest first: later runs in a chain are undone before the ones that set them off.
		const runs = this.log.filter((r) => (ids.includes(r.id) || (r.root !== undefined && ids.includes(r.root))) && !r.undone && this.undos.has(r.id));
		for (const r of runs) {
			const fn = this.undos.get(r.id)!;
			const id = r.id;
			if (!(await fn())) skipped = true;
			r.undone = true;
			this.undos.delete(id);
			n++;
		}
		if (n) {
			this.trigger("log");
			this.saveLog();
		}
		new Notice(n ? `Undid ${n === 1 ? "the workflow run" : `${n} workflow runs`}.${skipped ? " Fields changed since were left as they are." : ""}` : "Nothing to undo.");
	}

	/** Undo the newest run that can be undone. */
	async undoLast(): Promise<void> {
		const r = this.log.find((x) => !x.undone && this.undos.has(x.id));
		if (!r) return void new Notice("No workflow run to undo.");
		await this.undo([r.id]);
	}

	canUndo = (id: string) => this.undos.has(id) && !this.log.find((x) => x.id === id)?.undone;

	private record(r: RunRecord): RunRecord {
		this.log.unshift(r);
		if (this.log.length > LOG_LIMIT) this.log.length = LOG_LIMIT;
		this.trigger("log");
		this.saveLog();
		return r;
	}

	private get logPath(): string {
		return normalizePath(`${this.plugin.manifest.dir ?? ""}/workflow-log.json`);
	}

	private async readLog(): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.logPath))) return;
			const data = JSON.parse(await adapter.read(this.logPath)) as unknown;
			if (Array.isArray(data)) this.log = [...this.log, ...(data as RunRecord[])].slice(0, LOG_LIMIT);
			this.trigger("log");
		} catch {
			// A damaged log starts again.
		}
	}

	private async writeLog(): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(this.logPath, JSON.stringify(this.log));
		} catch (e) {
			console.error("Obsidian Entities: couldn't save the workflow log", e);
		}
	}
}
