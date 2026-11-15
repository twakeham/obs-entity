<script setup lang="ts">
import { withBase } from "vitepress";
</script>

<template>
	<section class="showcase">
		<figure class="shot main">
			<img :src="withBase('/showcase-project.png')" alt="A project dashboard in Obsidian: progress, budget and milestone cards, charts of stories, points and risks, and lists of top risks, open issues and milestones, beside the Entity Browser" />
			<figcaption>A project dashboard, built from linked notes: stories, risks, issues, budget lines and milestones. Pick another project and every card, chart and list follows.</figcaption>
		</figure>
	</section>
</template>

<style scoped>
.showcase {
	/* the same content width as the sections below: 1152px inside the padding */
	max-width: calc(1152px + 2 * 64px);
	margin: 0 auto;
	padding: 8px 24px 48px;
}
@media (min-width: 640px) {
	.showcase {
		padding: 8px 48px 56px;
	}
}
@media (min-width: 960px) {
	.showcase {
		padding: 16px 64px 64px;
	}
}
.shot {
	margin: 0;
}
.shot img {
	display: block;
	width: 100%;
	height: auto;
	border-radius: 12px;
	border: 1px solid var(--vp-c-divider);
	box-shadow: 0 24px 64px -16px rgba(0, 0, 0, 0.45);
}
.main img {
	box-shadow: 0 32px 96px -24px rgba(100, 108, 255, 0.35), 0 24px 64px -16px rgba(0, 0, 0, 0.5);
}
.shot figcaption {
	margin-top: 12px;
	font-size: 14px;
	line-height: 1.5;
	color: var(--vp-c-text-2);
	text-align: center;
}
</style>
