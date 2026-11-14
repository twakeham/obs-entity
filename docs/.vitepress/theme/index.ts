import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import Showcase from "./Showcase.vue";

export default {
	extends: DefaultTheme,
	// The home page's screenshots, full width under the hero (the hero's own image slot is too small for them).
	Layout: () => h(DefaultTheme.Layout, null, { "home-hero-after": () => h(Showcase) }),
} satisfies Theme;
