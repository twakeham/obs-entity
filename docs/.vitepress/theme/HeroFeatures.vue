<script setup lang="ts">
import { withBase } from "vitepress";

const features = [
	{
		icon: "🧩",
		title: "Data-driven notes",
		text: "Your own types with typed fields, links, roll-ups and formulas, edited in a form designed in a visual editor: frames, columns, tabs and fields that show only when they apply.",
		link: "/reference/form-layouts",
	},
	{
		icon: "📋",
		title: "Advanced tables",
		text: "Edit in place, roll-up and formula columns, grouping with totals, bulk edits, conditional highlights, data bars and colour scales.",
		link: "/reference/tables",
	},
	{
		icon: "🗂️",
		title: "Kanban boards and calendars",
		text: "Drag cards between statuses, choices or people, with swimlanes and card limits. Put any date on a calendar and drag to reschedule.",
		link: "/reference/boards",
	},
	{
		icon: "📊",
		title: "Dashboards",
		text: "Cards, charts, lists and buttons on a grid, with filters that make one dashboard follow any project or person.",
		link: "/reference/dashboards",
	},
	{
		icon: "⚡",
		title: "Workflow automation",
		text: "React to changes, add buttons and forms, run on a schedule or a date — with a run log and undo.",
		link: "/reference/workflows",
	},
];
</script>

<template>
	<div class="hero-features">
		<ul>
			<li v-for="f in features" :key="f.title">
				<a :href="withBase(f.link)">
					<span class="icon" aria-hidden="true">{{ f.icon }}</span>
					<span class="body">
						<span class="title">{{ f.title }}</span>
						<span class="text">{{ f.text }}</span>
					</span>
				</a>
			</li>
		</ul>
	</div>
</template>

<style>
/* The hero's image slot is sized for a logo: let it hold the feature list, beside the text on wide screens and after it on narrow ones. */
.VPHero .image {
	order: 3;
	margin: 32px 0 0;
}
.VPHero .image-container {
	width: auto;
	height: auto;
	transform: none;
}
.VPHero .image-bg {
	display: none;
}
@media (min-width: 960px) {
	.VPHero .image {
		order: 2;
		margin: 0 0 0 48px;
		flex: 1 1 0;
		min-width: 0;
	}
	.VPHero .image-container {
		height: 100%;
		align-items: center;
		transform: none;
	}
}
/* Too narrow for the list beside the text: under it, still left-aligned. */
@media (min-width: 960px) and (max-width: 1199px) {
	.VPHero.has-image .container {
		flex-direction: column;
	}
	.VPHero .image {
		flex: none;
		margin: 40px 0 0;
	}
	.VPHero .image-container {
		justify-content: flex-start;
	}
}
/* Stacked (narrow screens), the list is centred under the centred text. */
@media (max-width: 959px) {
	.VPHero .image-container {
		display: flex;
		justify-content: center;
	}
	.VPHero .hero-features {
		text-align: left;
	}
}
</style>

<style scoped>
.hero-features {
	width: 100%;
	max-width: 560px;
}
ul {
	list-style: none;
	margin: 0;
	padding: 0;
}
li + li {
	margin-top: 4px;
}
li a {
	display: flex;
	gap: 14px;
	padding: 10px;
	border-radius: 10px;
	color: inherit;
	text-decoration: none;
	transition: background-color 0.2s;
}
li a:hover {
	background: var(--vp-c-default-soft);
}
.icon {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border-radius: 8px;
	background: var(--vp-c-default-soft);
	font-size: 18px;
}
.body {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.title {
	font-weight: 600;
	font-size: 15px;
	line-height: 22px;
	color: var(--vp-c-text-1);
}
.text {
	font-size: 13.5px;
	line-height: 20px;
	color: var(--vp-c-text-2);
}
</style>
