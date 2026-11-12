import { Notice } from "obsidian";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { evalWhen, hiddenFields, todayDays, type WhenContext } from "../../model/formConditions";
import { isNoteItem, normaliseLayout, NOTE_ITEMS, resolveLayout, slotLabel, type LayoutField, type LayoutNode } from "../../model/formLayout";
import { fromFormFields, isEmptyValue, toFormFields, type EntityFormValues } from "../../model/frontmatter";
import { entityProblems, type FieldProblem } from "../../model/form";
import { COMMON_KEYS, statusesFor, storedFields, type EntityTypeDef, type FieldDef } from "../../model/types";
import { autoText, emptyFormValues, linkedValues, nextAutoNumber } from "../../model/defaults";
import { usePlugin } from "./context";
import { extraFrame, fieldControl, layoutNodes, ListControl, PropRow, StatusControl, tabOfKey } from "./EntityForm";
import { Icon } from "./Icon";
import { KIND_INFO } from "./types/editor";

export interface CreateFormProps {
	type: EntityTypeDef;
	initial: EntityFormValues;
	/** the type editor's preview: the dialog as it looks, without creating anything */
	preview?: boolean;
	/** pick another type (the modal opens the type picker) */
	onPickType?: (done: (t: EntityTypeDef) => void) => void;
	onSubmit?: (type: EntityTypeDef, values: EntityFormValues) => Promise<void>;
	onCancel?: () => void;
	/** receives the dialog's "create now" (for Ctrl/Cmd+Enter anywhere in the modal) */
	onSubmitReady?: (submit: () => void) => void;
	/**
	 * A workflow's form ("Fill in a form"): its title, icon and send button; no name, status, tags or folder, and
	 * every field shown. `type` is the form as a type (`formType`).
	 */
	workflowForm?: { title: string; button: string; icon: string };
}

/** What the dialog edits: relations held like the properties form's controls hold them (wikilinks). */
interface DialogState {
	name: string;
	status: string;
	tags: string[];
	fields: Record<string, unknown>;
}

const hasValue = (v: unknown) => !isEmptyValue(v) && v !== false;

/**
 * The create dialog's form: name and status, then the type's fields (its layout's frames marked "Show in create
 * dialog", or the fields set to show in the dialog), "Show N more fields", tags, and where the note will go.
 */
export function CreateForm({ type: initialType, initial, preview, onPickType, onSubmit, onCancel, onSubmitReady, workflowForm }: CreateFormProps) {
	const plugin = usePlugin();
	const [type, setType] = useState(initialType);
	useEffect(() => setType(initialType), [initialType]);
	/** fields the user has set (a linked note's value doesn't overwrite them) */
	const touched = useRef(new Set<string>());
	/** a linked note's frontmatter, for "from a linked note" defaults */
	const readLinked = (lp: string) => {
		const file = plugin.app.metadataCache.getFirstLinkpathDest(lp, "");
		return file ? (plugin.index.get(file.path)?.frontmatter ?? null) : null;
	};
	/**
	 * Fill "from a linked note" defaults: those copied through relation field `changed` (replacing what was copied
	 * before), or, with no `changed`, any that are still empty. Fields the user has set are left alone.
	 */
	const fillLinked = (t: EntityTypeDef, fields: Record<string, unknown>, changed?: string): Record<string, unknown> => {
		const keys = new Set(
			storedFields(t)
				.filter((f) => f.defaultFrom?.kind === "linked" && !touched.current.has(f.key) && (changed ? f.defaultFrom.via === changed : isEmptyValue(fields[f.key])))
				.map((f) => f.key),
		);
		if (!keys.size) return fields;
		const got = linkedValues(t, fields, readLinked, (k) => keys.has(k));
		const out = { ...fields };
		for (const k of keys) {
			if (got[k] !== undefined) out[k] = got[k];
			else if (changed) delete out[k];
		}
		return out;
	};
	const [state, setState] = useState<DialogState>(() => ({ name: initial.name, status: initial.status, tags: initial.tags, fields: fillLinked(initialType, toFormFields(initialType, initial.fields)) }));
	// Writes land in the ref at once, so a submit straight after a blur sees them.
	const stateRef = useRef(state);
	stateRef.current = state;
	const set = (patch: Partial<DialogState>) => {
		stateRef.current = { ...stateRef.current, ...patch };
		setState(stateRef.current);
	};
	const setField = (key: string, v: unknown) => {
		touched.current.add(key);
		set({ fields: fillLinked(type, { ...stateRef.current.fields, [key]: v }, key) });
	};
	const [showAll, setShowAll] = useState(false);
	// A workflow's form shows every field.
	const showing = showAll || !!workflowForm;
	const [busy, setBusy] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	/** each tab group's open tab */
	const [openTabs, setOpenTabs] = useState<Record<string, number>>({});
	/** required fields found empty on Create (their tabs get a dot) */
	const [missingKeys, setMissingKeys] = useState<string[]>([]);
	/** Create was tried: rule problems are shown from then on, as well as while typing */
	const [tried, setTried] = useState(false);
	const shownItems = useRef<LayoutNode[]>([]);
	/** fields rendered in the layout's frames and tabs (not the Required frame) at the last render */
	const renderedKeys = useRef<Set<string>>(new Set());
	/** the fields the dialog can set (calculated ones are worked out once the note exists) */
	const stored = storedFields(type);

	const whenCtx: WhenContext = {
		types: plugin.settings.types,
		groups: plugin.settings.groups,
		dates: plugin.dates,
		today: todayDays(),
		resolve: (lp) => plugin.app.metadataCache.getFirstLinkpathDest(lp, "")?.path ?? null,
	};
	/** the dialog's values as frontmatter, for "show only when" */
	const condValues = (s: DialogState): Record<string, unknown> => ({ ...s.fields, status: s.status, tags: s.tags });
	const layoutNow = type.form?.layout ? normaliseLayout(type.form.layout) : null;
	/** fields the layout's conditions hide for these values */
	const condHidden = (s: DialogState): Set<string> => (layoutNow ? hiddenFields(layoutNow, type, condValues(s), whenCtx) : new Set());
	/** fields whose "required when" holds for these values */
	const requiredNow = (s: DialogState): Set<string> =>
		new Set(stored.filter((f) => !f.required && f.rules?.requiredWhen && evalWhen(f.rules.requiredWhen, type, condValues(s), whenCtx)).map((f) => f.key));
	/** values that break their fields' validation rules (the dialog waits for them to be fixed) */
	const ruleProblems = (s: DialogState): FieldProblem[] => {
		if (!stored.some((f) => f.rules)) return [];
		const fm = { ...fromFormFields(type, s.fields), [COMMON_KEYS.status]: s.status, [COMMON_KEYS.tags]: s.tags };
		return entityProblems(type, fm, plugin.checkContext("")).filter((p) => p.rule && !p.missing);
	};

	const statuses = statusesFor(type, plugin.settings.groups);
	const status = statuses.includes(state.status) ? state.status : statuses[0];
	const values = (s: DialogState = stateRef.current): EntityFormValues => ({ name: s.name, status: statuses.includes(s.status) ? s.status : statuses[0], tags: s.tags, fields: fromFormFields(type, s.fields) });

	const submit = async () => {
		if (preview || busy) return;
		// Commit a text box that's still being typed in.
		const a = document.activeElement;
		if (a instanceof HTMLElement && rootRef.current?.contains(a) && a.matches("input, textarea")) a.blur();
		const s = stateRef.current;
		if (!workflowForm && !s.name.trim()) {
			new Notice("Please enter a name.");
			return;
		}
		// Required fields a condition hides aren't required just now.
		const off = condHidden(s);
		const now = requiredNow(s);
		// Auto-numbered fields get their number when the note is created.
		const missing = stored.filter((f) => (f.required || now.has(f.key)) && !hasValue(s.fields[f.key]) && !off.has(f.key) && f.defaultFrom?.kind !== "auto");
		const broken = ruleProblems(s);
		setMissingKeys(missing.map((f) => f.key));
		setTried(true);
		if (missing.length || broken.length) {
			const labelOf = (k: string) => stored.find((f) => f.key === k)?.label || k;
			if (missing.length) new Notice(`Required: ${missing.map((f) => f.label).join(", ")}`);
			if (broken.length) new Notice(broken.length === 1 ? `${labelOf(broken[0].key)}: ${broken[0].message}` : `Please fix: ${[...new Set(broken.map((p) => labelOf(p.key)))].join(", ")}`);
			// Open the tab with the first one that's in a tab on show.
			const keys = [...missing.map((f) => f.key), ...broken.map((p) => p.key)];
			const first = keys.find((k) => renderedKeys.current.has(k) && tabOfKey(shownItems.current, k));
			const t = first ? tabOfKey(shownItems.current, first) : null;
			if (t) setOpenTabs((o) => ({ ...o, [t.group]: t.tab }));
			return;
		}
		setBusy(true);
		try {
			await onSubmit?.(type, values(s));
		} finally {
			setBusy(false);
		}
	};
	const submitRef = useRef(submit);
	submitRef.current = submit;
	useEffect(() => {
		onSubmitReady?.(() => void submitRef.current());
	}, [onSubmitReady]);
	// A workflow's form has no name box to start in: its first text box (not a date's or a link's, whose calendar or
	// list would pop up).
	useEffect(() => {
		if (!workflowForm || preview) return;
		const dates = new Set(type.fields.filter((f) => f.kind === "date").map((f) => f.key));
		const first = [...(rootRef.current?.querySelectorAll<HTMLElement>(".oe-form-body .oe-prop-input") ?? [])].find((el) => !dates.has(el.closest<HTMLElement>(".oe-prop[data-key]")?.dataset.key ?? ""));
		first?.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const changeType = () =>
		onPickType?.((t) => {
			const blank = emptyFormValues(t, plugin.settings.groups);
			// Keep what's typed; fields the new type doesn't have are ignored when creating.
			set({ status: blank.status, fields: fillLinked(t, { ...toFormFields(t, blank.fields), ...stateRef.current.fields }) });
			setType(t);
		});

	// ---- rows: the properties form's rows, all editable, descriptions shown
	const shownKeys = new Set<string>();
	// Rule problems show as soon as a value breaks a rule; "required when" counts as required.
	const problemsNow = ruleProblems(state);
	const requiredKeys = requiredNow(state);
	const rowProblems = (key: string): FieldProblem[] => {
		const ps = problemsNow.filter((p) => p.key === key);
		if (tried && missingKeys.includes(key) && !hasValue(state.fields[key])) ps.push({ key, severity: "warning", message: "Required.", missing: true });
		return ps;
	};
	/** an auto-numbered field's placeholder: the number it will get */
	const autoPlaceholder = (f: FieldDef): string | undefined => {
		const d = f.defaultFrom;
		if (d?.kind !== "auto") return undefined;
		return `Next: ${autoText(d, nextAutoNumber(f, d, plugin.index.ofType(type.key).map((e) => e.frontmatter[f.key])))}`;
	};
	/** the Name box (at the top, or where the layout places the note's name) */
	const nameInput = (placeholder?: string) => (
		<input
			type="text"
			className="oe-prop-input oe-create-name"
			placeholder={placeholder || `${type.name} name`}
			aria-label="Name"
			value={state.name}
			autoFocus={!preview}
			onChange={(e) => set({ name: e.target.value })}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !e.nativeEvent.isComposing) {
					e.preventDefault();
					void submit();
				}
			}}
		/>
	);
	/**
	 * A property's row (null for properties the dialog doesn't set: related, aliases, order, and status, which is at the
	 * top). `slot`: its place in the layout (custom label, placeholder, help text; read-only slots can still be set here).
	 */
	const propFor = (key: string, slot?: LayoutField): ReactNode | null => {
		const labelPos = slot ? slotLabel(slot) : undefined;
		// The note's name, when the layout places it: the dialog's Name box goes there. (Type, subtitle and dates aren't set here.)
		if (key === NOTE_ITEMS.name) {
			shownKeys.add(key);
			return (
				<PropRow key={key} k="name" label={slot?.caption || "Name"} icon="text-cursor-input" help={typeof slot?.help === "object" ? slot.help.text : undefined} problems={[]} empty={!state.name} editable onFix={() => {}} labelPos={labelPos}>
					<span className="oe-form-name">{nameInput(slot?.placeholder)}</span>
				</PropRow>
			);
		}
		if (isNoteItem(key)) return null;
		const f = stored.find((x) => x.key === key);
		if (f) {
			shownKeys.add(key);
			return (
				<PropRow
					key={key}
					k={key}
					label={slot?.caption || f.label || f.key}
					icon={KIND_INFO[f.kind].icon}
					required={f.required || requiredKeys.has(key)}
					desc={f.description}
					help={(typeof slot?.help === "object" ? slot.help.text : undefined) || f.description?.trim() || undefined}
					problems={rowProblems(key)}
					empty={!hasValue(state.fields[key])}
					editable
					onFix={() => {}}
					labelPos={labelPos}
				>
					{fieldControl(f, { value: state.fields[key], editable: true, path: "", type, live: false, problems: [], onCommit: (v) => setField(key, v), placeholder: slot?.placeholder || autoPlaceholder(f), rows: slot?.rows })}
				</PropRow>
			);
		}
		if (key === COMMON_KEYS.tags) {
			shownKeys.add(key);
			return (
				<PropRow key={key} k={key} label={slot?.caption || "Tags"} icon="tags" help={typeof slot?.help === "object" ? slot.help.text : undefined} problems={[]} empty={!state.tags.length} editable onFix={() => {}} labelPos={labelPos}>
					<ListControl value={state.tags} editable label="Tags" tag placeholder={slot?.placeholder} onCommit={(v) => set({ tags: (Array.isArray(v) ? v : []).map((x) => String(x).replace(/^#/, "")) })} />
				</PropRow>
			);
		}
		return null;
	};

	const layout = type.form?.layout ? normaliseLayout(type.form.layout) : null;
	const resolved = layout ? resolveLayout(layout, type) : null;
	let body: ReactNode;
	let hidden = 0;
	if (!resolved) {
		// No layout: the fields set to show in the dialog, required ones, subtitle fields and any with a value.
		const subtitle = new Set(type.card?.subtitle ?? []);
		const visible = stored.filter((f) => showing || f.inModal || f.required || requiredKeys.has(f.key) || subtitle.has(f.key) || hasValue(state.fields[f.key]));
		hidden = stored.length - visible.length;
		body = <div className="oe-form-rows">{visible.map((f) => propFor(f.key))}</div>;
	} else {
		// The layout's frames and tabs marked "Show in create dialog" (all of them with "Show more fields").
		shownItems.current = resolved.items;
		const nodes = layoutNodes(resolved.items, propFor, {
			closed: new Set(),
			toggle: () => {},
			flagged: (keys) => keys.some((k) => (missingKeys.includes(k) && !hasValue(state.fields[k])) || problemsNow.some((p) => p.key === k)),
			include: (part) => showing || part.create !== false,
			shows: (w) => evalWhen(w, type, condValues(state), whenCtx),
			tab: (g) => openTabs[g] ?? 0,
			setTab: (g, t) => setOpenTabs((o) => ({ ...o, [g]: t })),
			typeColor: type.color,
		});
		renderedKeys.current = new Set(shownKeys);
		// Required fields, and ones already filled in, that aren't on show yet: asked for in a frame of their own.
		// (Not ones a condition hides.)
		const off = condHidden(state);
		const outside = stored.filter((f) => !shownKeys.has(f.key) && !off.has(f.key));
		const needed = showing ? [] : outside.filter((f) => f.required || requiredKeys.has(f.key) || hasValue(state.fields[f.key]));
		if (needed.length) nodes.push(extraFrame("required", needed.every((f) => f.required || requiredKeys.has(f.key)) ? "Required" : "Required and filled in", needed.map((f) => propFor(f.key)), "is-required"));
		// Fields that aren't placed, with "Show more fields".
		if (showing && !layout!.hideUnplaced) {
			const others = resolved.unplaced.filter((k) => !shownKeys.has(k)).map((k) => propFor(k));
			if (others.length) nodes.push(extraFrame("other", workflowForm ? "More" : "Other fields", others));
		}
		hidden = stored.filter((f) => !shownKeys.has(f.key) && !off.has(f.key)).length;
		body = <div className="oe-form-layout">{nodes}</div>;
	}

	const factoryValues = values(state);
	const folder = workflowForm ? "" : plugin.factory.folderFor(type, { ...factoryValues, name: factoryValues.name || type.name });

	return (
		<div ref={rootRef} className={`oe-form oe-create-form is-editing${workflowForm ? " is-workflow-form" : ""}`} style={{ "--oe-type-color": type.color } as CSSProperties} data-entity-type={type.key}>
			<div className="oe-modal-header">
				<span className="oe-type-icon oe-type-icon-lg" style={{ "--oe-type-color": type.color } as CSSProperties}>
					<Icon name={workflowForm?.icon ?? type.icon} />
				</span>
				<h2>{workflowForm ? workflowForm.title : `New ${(type.name || "entity").toLowerCase()}`}</h2>
				{onPickType && (
					<button type="button" className="clickable-icon oe-change-type" aria-label="Change type" onClick={changeType}>
						<Icon name="repeat" />
					</button>
				)}
			</div>
			{!workflowForm && (
				<div className="oe-form-rows oe-create-top">
					{!shownKeys.has(NOTE_ITEMS.name) && (
						<PropRow k="name" label="Name" icon="text-cursor-input" problems={[]} empty={!state.name} editable onFix={() => {}}>
							{nameInput()}
						</PropRow>
					)}
					<PropRow k="status" label="Status" icon="circle-dot" problems={[]} empty={false} editable onFix={() => {}}>
						<StatusControl type={type} value={status} editable problem={undefined} onCommit={(v) => set({ status: String(v ?? "") })} />
					</PropRow>
				</div>
			)}
			<div className="oe-form-body">{body}</div>
			{!workflowForm && (hidden > 0 || showAll) && (
				<button type="button" className="oe-form-more" onClick={() => setShowAll(!showAll)}>
					{showAll ? "Show fewer fields" : `Show ${hidden} more field${hidden === 1 ? "" : "s"}`}
				</button>
			)}
			{!workflowForm && !shownKeys.has(COMMON_KEYS.tags) && <div className="oe-form-rows oe-create-tags">{propFor(COMMON_KEYS.tags)}</div>}
			{!workflowForm && <div className="oe-create-folder">Will be created in {folder || "the vault root"}/</div>}
			<div className="oe-create-buttons">
				<button type="button" onClick={onCancel} disabled={preview}>
					Cancel
				</button>
				<button type="button" className="mod-cta" onClick={() => void submit()} disabled={preview || busy}>
					{workflowForm ? workflowForm.button.trim() || "Run" : "Create"}
				</button>
			</div>
		</div>
	);
}
