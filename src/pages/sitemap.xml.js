import { getCollection } from 'astro:content';

export async function GET({ site }) {
	const posts = await getCollection('blog');
	const paths = ['/', '/blog/', ...posts.map((post) => `/blog/${post.id}/`)];
	const urls = paths.map((path) => `  <url><loc>${new URL(path, site)}</loc></url>`).join('\n');

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		{ headers: { 'Content-Type': 'application/xml' } },
	);
}
