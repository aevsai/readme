// @ts-check

import mdx from '@astrojs/mdx';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://aevsai.me',
	integrations: [mdx()],
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Shantell Sans',
			cssVariable: '--font-shantell',
			fallbacks: ['system-ui', 'sans-serif'],
			weights: [400, 500, 700],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
		},
	],
});
