import { defineConfig } from "vitepress";

const gettingStarted = [
	{ text: "What you'll build", link: "/getting-started/" },
	{ text: "1. Your first types", link: "/getting-started/first-types" },
	{ text: "2. Creating notes", link: "/getting-started/creating-notes" },
	{ text: "3. Linking notes", link: "/getting-started/linking-notes" },
	{ text: "4. Roll-ups and formulas", link: "/getting-started/calculated-fields" },
	{ text: "5. Views", link: "/getting-started/views" },
	{ text: "6. A workflow", link: "/getting-started/workflows" },
	{ text: "7. A dashboard", link: "/getting-started/dashboards" },
	{ text: "Next steps", link: "/getting-started/next-steps" },
];

const guides = [
	{ text: "Start from a pack", link: "/guides/packs" },
	{ text: "Tour: project management", link: "/guides/project-management" },
	{ text: "Design a form", link: "/guides/form-layouts" },
	{ text: "Validate what goes in", link: "/guides/validation" },
	{ text: "Smart defaults", link: "/guides/defaults" },
	{ text: "Organise notes in folders", link: "/guides/folders" },
	{ text: "Views inside notes", link: "/guides/views-in-notes" },
	{ text: "A dashboard that follows a note", link: "/guides/dashboard-filters" },
	{ text: "Workflow recipes", link: "/guides/workflow-recipes" },
	{ text: "Share your setup", link: "/guides/sharing" },
];

const reference = [
	{
		text: "Data",
		items: [
			{ text: "Entity notes", link: "/reference/notes" },
			{ text: "Types and groups", link: "/reference/types" },
			{ text: "Fields", link: "/reference/fields" },
			{ text: "Relationships", link: "/reference/relationships" },
			{ text: "Roll-ups", link: "/reference/rollups" },
			{ text: "Formulas", link: "/reference/formulas" },
		],
	},
	{
		text: "Working with notes",
		items: [
			{ text: "Properties form", link: "/reference/properties-form" },
			{ text: "Form layouts", link: "/reference/form-layouts" },
			{ text: "Entity Browser", link: "/reference/browser" },
			{ text: "Side panel", link: "/reference/side-panel" },
		],
	},
	{
		text: "Views and dashboards",
		items: [
			{ text: "Tables", link: "/reference/tables" },
			{ text: "Boards", link: "/reference/boards" },
			{ text: "Calendars", link: "/reference/calendars" },
			{ text: "Filters, sorting and highlights", link: "/reference/filters" },
			{ text: "Dashboards", link: "/reference/dashboards" },
		],
	},
	{
		text: "Automation",
		items: [
			{ text: "Workflows", link: "/reference/workflows" },
			{ text: "Triggers", link: "/reference/triggers" },
			{ text: "Steps", link: "/reference/steps" },
		],
	},
	{
		text: "Everything else",
		items: [
			{ text: "Packs and apps", link: "/reference/packs" },
			{ text: "Commands", link: "/reference/commands" },
			{ text: "Settings", link: "/reference/settings" },
		],
	},
];

export default defineConfig({
	title: "Obsidian Entities",
	description: "Your own entity types, relationships, views, dashboards and workflows, as ordinary Markdown notes.",
	base: "/obs-entity/",
	// The design spec lives in docs/ too, but isn't part of the site.
	srcExclude: ["DESIGN.md"],
	cleanUrls: true,
	lastUpdated: true,
	themeConfig: {
		nav: [
			{ text: "Guide", link: "/guide/introduction" },
			{ text: "Getting started", link: "/getting-started/" },
			{ text: "How-to", link: "/guides/packs" },
			{ text: "Reference", link: "/reference/notes" },
		],
		sidebar: {
			"/guide/": [
				{ text: "Guide", items: [{ text: "Introduction", link: "/guide/introduction" }, { text: "Installation", link: "/guide/installation" }, { text: "Concepts", link: "/guide/concepts" }] },
				{ text: "Getting started", items: gettingStarted },
			],
			"/getting-started/": [{ text: "Getting started", items: gettingStarted }],
			"/guides/": [{ text: "How-to guides", items: guides }],
			"/reference/": reference,
		},
		search: { provider: "local" },
		socialLinks: [{ icon: "github", link: "https://github.com/twakeham/obs-entity" }],
		editLink: { pattern: "https://github.com/twakeham/obs-entity/edit/main/docs/:path", text: "Edit this page on GitHub" },
		outline: { level: [2, 3] },
	},
});
