import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionKeymap, completionStatus, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, keymap, placeholder, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Modal } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type EntitiesPlugin from "../../main";
import { compile, findColumn, FormulaError, FTYPE_LABEL, FTYPES, FUNCTIONS, functionDef, toDisplay, toStored, type FnCategory, type FnDef, type FType, type RefColumn } from "../../model/formula";
import { toKey, type EntityTypeDef } from "../../model/types";
import { cellOf, formulaRefColumns, resolveColumn, runView, type ColumnDef, type ViewDef, type ViewRow } from "../../model/views";
import { PluginContext } from "../react/context";
import { Icon } from "../react/Icon";

type FormulaCol = Extract<ColumnDef, { kind: "formula" }>;

/** For a type's formula field: every type as edited (the draft in place of its saved version), and the field's label. */
export interface FormulaFieldOpts {
	types: EntityTypeDef[];
	label: string;
}

const KEYWORDS = ["and", "or", "not", "true", "false", "item"];
const CATEGORIES: FnCategory[] = ["Logic", "Maths", "Text", "Dates", "Lists", "Links"];

/** Lenient tokens for colouring (works on unfinished formulas). */
function highlightRanges(src: string, known: (name: string) => boolean): { from: number; to: number; cls: string }[] {
	const out: { from: number; to: number; cls: string }[] = [];
	const re = /\[[^\]\n]*\]?|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\d+(?:\.\d+)?|[A-Za-z_]\w*|<=|>=|!=|<>|==|&&|\|\||[-+*/%&=<>!]/g;
	for (let m = re.exec(src); m; m = re.exec(src)) {
		const t = m[0];
		const from = m.index;
		const to = from + t.length;
		let cls: string;
		if (t.startsWith("[")) cls = t.endsWith("]") && known(t.slice(1, -1)) ? "oe-fx-ref" : "oe-fx-ref is-bad";
		else if (t.startsWith('"') || t.startsWith("'")) cls = "oe-fx-str";
		else if (/^\d/.test(t)) cls = "oe-fx-num";
		else if (/^[A-Za-z_]/.test(t)) {
			const next = src.slice(to).match(/^\s*\(/);
			cls = KEYWORDS.includes(t.toLowerCase()) ? "oe-fx-kw" : next ? (functionDef(t) ? "oe-fx-fn" : "oe-fx-fn is-bad") : "oe-fx-name";
		} else cls = "oe-fx-op";
		out.push({ from, to, cls });
	}
	return out;
}

function fnInfo(f: FnDef): HTMLElement {
	const el = document.createElement("div");
	el.className = "oe-fx-info";
	el.createDiv({ cls: "oe-fx-info-sig", text: f.sig });
	el.createDiv({ cls: "oe-fx-info-desc", text: f.desc });
	const ex = el.createDiv({ cls: "oe-fx-info-ex" });
	ex.createSpan({ text: "e.g. " });
	ex.createEl("code", { text: f.example });
	return el;
}

/** The formula editor: name, a CodeMirror editor with completion, hover help and live checks, a preview, and a function reference. */
function FormulaEditor({
	plugin,
	def,
	existing,
	onSave,
	onCancel,
	field,
}: {
	plugin: EntitiesPlugin;
	def: ViewDef;
	existing: FormulaCol | null;
	onSave: (c: FormulaCol) => void;
	onCancel: () => void;
	/** a type's formula field (not a view column): the types as edited, and the field's label (no name box) */
	field?: FormulaFieldOpts;
}) {
	const lookup = useMemo(() => ({ types: field?.types ?? plugin.settings.types, groups: plugin.settings.groups }), [plugin, field]);
	const id = useMemo(() => {
		if (existing) return existing.id;
		const taken = new Set(def.columns.map((c) => c.id));
		let n = 1;
		while (taken.has(`formula_${n}`)) n++;
		return `formula_${n}`;
	}, [def, existing]);
	const refCols: RefColumn[] = useMemo(() => formulaRefColumns(def, lookup).filter((c) => c.id !== id), [def, lookup, id]);
	const [name, setName] = useState(existing?.label ?? "");
	const [text, setText] = useState(() => (existing ? toDisplay(existing.formula, refCols) : ""));
	const [type, setType] = useState<FType | "">(existing?.type ?? "");
	const [search, setSearch] = useState("");
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const latest = useRef({ text, type: type as FType | "", name, save: () => {} });

	// The view's data once, and its first rows for the preview (a draft type stands in for its saved version).
	const data = useMemo(() => {
		const d = plugin.viewData();
		if (!field) return d;
		const byKey = new Map(field.types.map((t) => [t.key, t]));
		return { rows: d.rows.map((r) => (byKey.has(r.type.key) && byKey.get(r.type.key) !== r.type ? { ...r, type: byKey.get(r.type.key)! } : r)), ctx: { ...d.ctx, types: field.types } };
	}, [plugin, field]);
	const sample: ViewRow[] = useMemo(() => runView(def, data.rows, data.ctx).rows.slice(0, 5).map((r) => r.row), [data, def]);

	/** The column as it would be saved, and the definition with it in place. */
	const build = (src: string, t: FType | "", label: string): { col: FormulaCol; tmp: ViewDef } => {
		const col: FormulaCol = { kind: "formula", id, formula: toStored(src, refCols), label: label.trim() || "Formula", ...(t ? { type: t } : {}) };
		const columns = existing ? def.columns.map((c) => (c.id === id ? col : c)) : [...def.columns, col];
		return { col, tmp: { ...def, columns } };
	};

	/** Problems with the formula: syntax and references (with positions), then resolution problems such as loops. */
	const check = (src: string, t: FType | "", label: string) => {
		try {
			const c = compile(src, refCols);
			const { col, tmp } = build(src, t, label);
			const resolved = resolveColumn(col, tmp, lookup);
			if (resolved.invalid) return { error: { message: resolved.invalid, from: 0, to: src.length }, inferred: c.type };
			return { inferred: c.type, resolved };
		} catch (e) {
			const err = e instanceof FormulaError ? e : new FormulaError(String(e));
			return { error: { message: err.message, from: err.from, to: err.to } };
		}
	};
	const status = useMemo(() => check(text, type, name), [text, type, name, refCols]); // eslint-disable-line react-hooks/exhaustive-deps

	const save = () => {
		const s = check(latest.current.text, type, name);
		if (s.error) return;
		const col = build(latest.current.text, type, name).col;
		// A new column's id comes from its name (the editor works with a placeholder id until then).
		if (!existing) col.id = formulaId(col.label ?? "formula", def.columns.map((c) => c.id));
		onSave(col);
	};
	latest.current = { text, type, name, save };

	// ---- CodeMirror
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		const known = (n: string) => !!findColumn(n, refCols);
		const colour = ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				constructor(v: EditorView) {
					this.decorations = this.make(v);
				}
				update(u: ViewUpdate) {
					if (u.docChanged) this.decorations = this.make(u.view);
				}
				make(v: EditorView): DecorationSet {
					const b = new RangeSetBuilder<Decoration>();
					for (const r of highlightRanges(v.state.doc.toString(), known)) b.add(r.from, r.to, Decoration.mark({ class: r.cls }));
					return b.finish();
				}
			},
			{ decorations: (v) => v.decorations },
		);
		const complete = (cx: CompletionContext): CompletionResult | null => {
			const before = cx.state.sliceDoc(Math.max(0, cx.pos - 200), cx.pos);
			const ref = /\[([^\]\n]*)$/.exec(before);
			if (ref) {
				const from = cx.pos - ref[1].length;
				const closed = cx.state.sliceDoc(cx.pos, cx.pos + 1) === "]";
				const options: Completion[] = refCols.map((c) => ({
					label: c.label,
					detail: FTYPE_LABEL[c.type],
					type: "variable",
					apply: (v, _c, f, t) => {
						const end = closed ? t + 1 : t;
						v.dispatch({ changes: { from: f, to: end, insert: `${c.label}]` }, selection: { anchor: f + c.label.length + 1 } });
					},
				}));
				return { from, options, validFor: /^[^\]\n]*$/ };
			}
			const word = cx.matchBefore(/[A-Za-z_]\w*/);
			if (!word && !cx.explicit) return null;
			const from = word ? word.from : cx.pos;
			const fns: Completion[] = FUNCTIONS.map((f) => ({
				label: f.sig.split("(")[0],
				detail: f.sig.slice(f.sig.indexOf("(")),
				type: "function",
				section: f.cat,
				info: () => fnInfo(f),
				apply: (v, _c, a, b) => {
					const name = f.sig.split("(")[0];
					v.dispatch({ changes: { from: a, to: b, insert: `${name}()` }, selection: { anchor: a + name.length + (f.max === 0 ? 2 : 1) } });
				},
			}));
			const kws: Completion[] = KEYWORDS.map((k) => ({ label: k, type: "keyword" }));
			return { from, options: [...fns, ...kws], validFor: /^\w*$/ };
		};
		const hover = hoverTooltip((v, pos) => {
			const line = v.state.doc.lineAt(pos);
			const rel = pos - line.from;
			const s = line.text;
			// a [reference] under the pointer
			const open = s.lastIndexOf("[", rel);
			const close = s.indexOf("]", open);
			if (open >= 0 && close >= rel && !s.slice(open, rel).includes("]")) {
				const c = findColumn(s.slice(open + 1, close), refCols);
				return {
					pos: line.from + open,
					end: line.from + close + 1,
					above: true,
					create: () => {
						const dom = document.createElement("div");
						dom.className = "oe-fx-info";
						if (c) {
							dom.createDiv({ cls: "oe-fx-info-sig", text: c.label });
							dom.createDiv({ cls: "oe-fx-info-desc", text: `${FTYPE_LABEL[c.type]} column (${c.id})` });
						} else dom.createDiv({ cls: "oe-fx-info-desc", text: "Unknown column" });
						return { dom };
					},
				};
			}
			let a = rel;
			let b = rel;
			while (a > 0 && /\w/.test(s[a - 1])) a--;
			while (b < s.length && /\w/.test(s[b])) b++;
			const f = a < b ? functionDef(s.slice(a, b)) : undefined;
			if (!f) return null;
			return { pos: line.from + a, end: line.from + b, above: true, create: () => ({ dom: fnInfo(f) }) };
		});
		const lint = linter(
			(v) => {
				const s = check(v.state.doc.toString(), latest.current.type, latest.current.name);
				if (!s.error || !v.state.doc.length) return [];
				const len = v.state.doc.length;
				const from = Math.min(s.error.from, len);
				const to = Math.min(Math.max(s.error.to, from + 1), len);
				return [{ from: from === len && len ? len - 1 : from, to: from === len && len ? len : to, severity: "error", message: s.error.message } as Diagnostic];
			},
			{ delay: 250 },
		);
		const ev = new EditorView({
			parent: el,
			state: EditorState.create({
				doc: latest.current.text,
				extensions: [
					history(),
					closeBrackets(),
					bracketMatching(),
					autocompletion({ override: [complete], activateOnTyping: true, icons: false }),
					colour,
					hover,
					lint,
					placeholder("e.g. [Budget] / [Tasks]  ·  type [ for columns"),
					EditorView.lineWrapping,
					keymap.of([
						{
							key: "Mod-Enter",
							run: () => {
								latest.current.save();
								return true;
							},
						},
						...closeBracketsKeymap,
						...completionKeymap,
						...historyKeymap,
						...defaultKeymap,
					]),
					EditorView.updateListener.of((u) => u.docChanged && setText(u.state.doc.toString())),
				],
			}),
		});
		view.current = ev;
		window.setTimeout(() => {
			ev.focus();
			ev.dispatch({ selection: { anchor: ev.state.doc.length } });
		}, 0);
		return () => {
			ev.destroy();
			view.current = null;
		};
	// The editor is created once per column list; checks read the latest name and type through `latest`.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [refCols]);

	const insert = (snippet: string, caret: number) => {
		const v = view.current;
		if (!v) return;
		const { from, to } = v.state.selection.main;
		v.dispatch({ changes: { from, to, insert: snippet }, selection: { anchor: from + caret } });
		v.focus();
	};

	// ---- preview
	const preview = useMemo(() => {
		if (!status.resolved) return [];
		return sample.map((row) => ({ name: row.name, cell: cellOf(row, status.resolved!, data.ctx) }));
	}, [status, sample, data]);

	const q = search.trim().toLowerCase();
	const fnList = FUNCTIONS.filter((f) => !q || f.name.includes(q) || f.desc.toLowerCase().includes(q));
	const colList = refCols.filter((c) => !q || c.label.toLowerCase().includes(q));

	return (
		<div className="oe-fx">
			<div className="oe-fx-main">
				{!field && (
					<label className="oe-fx-field">
						<span>Name</span>
						<input type="text" value={name} placeholder="e.g. Days left" onChange={(e) => setName(e.target.value)} aria-label="Column name" />
					</label>
				)}
				<div className="oe-fx-field">
					<span>Formula</span>
					<div ref={host} className={`oe-fx-editor${status.error && text ? " has-error" : ""}`} />
				</div>
				<div className={`oe-fx-status${status.error && text ? " is-error" : ""}`}>
					{!text.trim() ? (
						<span className="oe-pop-hint">Type [ to pick a column, or start typing a function name. Ctrl/Cmd+Space shows suggestions.</span>
					) : status.error ? (
						<>
							<Icon name="alert-circle" /> {status.error.message}
						</>
					) : (
						<>
							<Icon name="check-circle" /> Result: {FTYPE_LABEL[status.inferred ?? "any"]}
						</>
					)}
				</div>
				<label className="oe-fx-field is-inline">
					<span>Result type</span>
					<select className="dropdown" value={type} onChange={(e) => setType(e.target.value as FType | "")} aria-label="Result type">
						<option value="">Automatic{status.inferred ? ` (${FTYPE_LABEL[status.inferred]})` : ""}</option>
						{FTYPES.map((t) => (
							<option key={t} value={t}>
								{FTYPE_LABEL[t]}
							</option>
						))}
					</select>
				</label>
				<div className="oe-fx-preview">
					<div className="oe-pop-heading">Preview</div>
					{!status.resolved ? (
						<div className="oe-pop-empty">The first rows' results appear here.</div>
					) : sample.length === 0 ? (
						<div className="oe-pop-empty">The view has no rows to preview.</div>
					) : (
						<table>
							<tbody>
								{preview.map((p, i) => (
									<tr key={i}>
										<td className="oe-fx-preview-name">{p.name}</td>
										<td className={p.cell.error ? "is-error" : ""}>{p.cell.error ? `– ${p.cell.error}` : p.cell.text || <span className="oe-pop-empty">(empty)</span>}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
				<div className="oe-fx-buttons">
					<span className="oe-pop-hint">Ctrl/Cmd+Enter to save</span>
					<span className="oe-spacer" />
					<button onClick={onCancel}>Cancel</button>
					<button className="mod-cta" disabled={!!status.error} onClick={save}>
						Save
					</button>
				</div>
			</div>
			<div className="oe-fx-side">
				<input type="search" placeholder="Search functions and columns…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search functions and columns" />
				<div className="oe-fx-ref-list">
					{colList.length > 0 && (
						<div className="oe-fx-ref-cat">
							<div className="oe-pop-heading">Columns</div>
							{colList.map((c) => (
								<button key={c.id} className="oe-fx-ref-item" onClick={() => insert(`[${c.label}]`, c.label.length + 2)} aria-label={`${FTYPE_LABEL[c.type]} column`}>
									<span className="oe-fx-ref">[{c.label}]</span>
									<span className="oe-fx-ref-type">{FTYPE_LABEL[c.type]}</span>
								</button>
							))}
						</div>
					)}
					{CATEGORIES.map((cat) => {
						const fs = fnList.filter((f) => f.cat === cat);
						if (!fs.length) return null;
						return (
							<div key={cat} className="oe-fx-ref-cat">
								<div className="oe-pop-heading">{cat}</div>
								{fs.map((f) => {
									const n = f.sig.split("(")[0];
									return (
										<button key={f.name} className="oe-fx-ref-item" onClick={() => insert(`${n}()`, n.length + (f.max === 0 ? 2 : 1))} aria-label={`${f.desc} e.g. ${f.example}`}>
											<span className="oe-fx-fn">{n}</span>
											<span className="oe-fx-ref-type">{f.sig.slice(f.sig.indexOf("("))}</span>
										</button>
									);
								})}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/** Add or edit a formula column. */
export class FormulaModal extends Modal {
	private root: Root | null = null;
	/** set while an Esc keypress is closing the suggestion list, so it doesn't also close the dialog */
	private escClosingList = false;

	constructor(
		private plugin: EntitiesPlugin,
		private def: ViewDef,
		private existing: FormulaCol | null,
		private done: (col: FormulaCol) => void,
		private field?: FormulaFieldOpts,
	) {
		super(plugin.app);
	}

	close(): void {
		// Esc with the suggestion list open closes the list only. Obsidian may handle Esc before the editor
		// (list still open) or after it (list just closed, noted by the capture listener below).
		const dom = this.contentEl.querySelector<HTMLElement>(".cm-editor");
		const v = dom ? EditorView.findFromDOM(dom) : null;
		if (v && completionStatus(v.state) !== null) {
			closeCompletion(v);
			return;
		}
		if (this.escClosingList) return;
		super.close();
	}

	onOpen(): void {
		this.titleEl.setText(this.field ? `Formula: ${this.field.label || "new field"}` : this.existing ? "Edit formula" : "New formula column");
		this.modalEl.addClass("oe-fx-modal");
		// Capture runs before the editor closes the list (and before Obsidian's Esc handling).
		this.modalEl.addEventListener(
			"keydown",
			(e) => {
				if (e.key !== "Escape") return;
				const dom = this.contentEl.querySelector<HTMLElement>(".cm-editor");
				const v = dom ? EditorView.findFromDOM(dom) : null;
				this.escClosingList = !!v && completionStatus(v.state) !== null;
				window.setTimeout(() => (this.escClosingList = false), 0);
			},
			true,
		);
		this.root = createRoot(this.contentEl);
		this.root.render(
			<PluginContext.Provider value={this.plugin}>
				<FormulaEditor
					plugin={this.plugin}
					def={this.def}
					existing={this.existing}
					field={this.field}
					onCancel={() => this.close()}
					onSave={(c) => {
						this.close();
						this.done(c);
					}}
				/>
			</PluginContext.Provider>,
		);
	}

	onClose(): void {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}

export const formulaId = (label: string, taken: string[]): string => {
	const base = toKey(label) || "formula";
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
	return id;
};
