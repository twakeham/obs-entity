import { describe, expect, it } from "vitest";
import { typeMatches, viewMatches, workflowMatches, type BrowserFilter } from "../src/model/browserFilter";
import type { EntityTypeDef } from "../src/model/types";
import { newWorkflow, type WorkflowDef } from "../src/model/workflows";

const type = (key: string, group = "work"): EntityTypeDef => ({ key, name: key[0].toUpperCase() + key.slice(1), plural: `${key}s`, icon: "x", color: "", group, template: "", fields: [], builtIn: false });
const TYPES = [type("task"), type("project"), type("person", "people")];
const f = (over: Partial<BrowserFilter> = {}): BrowserFilter => ({ query: "", type: "", status: "", tag: "", ...over });
const wf = (over: Partial<WorkflowDef>): WorkflowDef => ({ ...newWorkflow([]), name: "W", ...over });

describe("browser filters on views and workflows", () => {
	it("match views by name and by the types they show", () => {
		expect(viewMatches("Open tasks", ["task"], f({ query: "open" }), TYPES)).toBe(true);
		expect(viewMatches("Open tasks", ["task"], f({ query: "board" }), TYPES)).toBe(false);
		expect(viewMatches("Open tasks", ["task"], f({ type: "task" }), TYPES)).toBe(true);
		expect(viewMatches("Open tasks", ["task"], f({ type: "project" }), TYPES)).toBe(false);
		// A group's view, and one of every type, show tasks too.
		expect(viewMatches("Work", ["@work"], f({ type: "task" }), TYPES)).toBe(true);
		expect(viewMatches("Work", ["@work"], f({ type: "person" }), TYPES)).toBe(false);
		expect(viewMatches("All", ["*"], f({ type: "person" }), TYPES)).toBe(true);
		expect(viewMatches("All", [], f({ type: "person" }), TYPES)).toBe(true);
	});

	it("match workflows by name or button label and by the types they apply to", () => {
		const close = wf({ name: "Close out", scope: ["task"], trigger: { kind: "manual", label: "Mark done" } });
		expect(workflowMatches(close, f({ query: "close" }), TYPES)).toBe(true);
		expect(workflowMatches(close, f({ query: "mark" }), TYPES)).toBe(true);
		expect(workflowMatches(close, f({ query: "kick" }), TYPES)).toBe(false);
		expect(workflowMatches(close, f({ type: "task" }), TYPES)).toBe(true);
		expect(workflowMatches(close, f({ type: "project" }), TYPES)).toBe(false);
		// A button for any note applies to every type.
		expect(workflowMatches(wf({ scope: [], trigger: { kind: "manual" } }), f({ type: "person" }), TYPES)).toBe(true);
	});

	it("leave views and workflows out when filtering by status or tag (only entities have them)", () => {
		expect(viewMatches("Open tasks", ["task"], f({ status: "done" }), TYPES)).toBe(false);
		expect(viewMatches("Open tasks", ["task"], f({ tag: "x" }), TYPES)).toBe(false);
		expect(workflowMatches(wf({ name: "A" }), f({ status: "done" }), TYPES)).toBe(false);
		expect(workflowMatches(wf({ name: "A" }), f({ tag: "x" }), TYPES)).toBe(false);
	});

	it("match entity types by name, plural or key, and by the type filter", () => {
		expect(typeMatches(TYPES[0], f({ query: "task" }))).toBe(true);
		expect(typeMatches(TYPES[0], f({ query: "tasks" }))).toBe(true);
		expect(typeMatches(TYPES[2], f({ query: "pers" }))).toBe(true);
		expect(typeMatches(TYPES[2], f({ query: "task" }))).toBe(false);
		expect(typeMatches(TYPES[0], f({ type: "task" }))).toBe(true);
		expect(typeMatches(TYPES[0], f({ type: "project" }))).toBe(false);
		expect(typeMatches(TYPES[0], f({ status: "done" }))).toBe(false);
		expect(typeMatches(TYPES[0], f())).toBe(true);
	});
});
