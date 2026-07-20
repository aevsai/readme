const IMAGE_EXTENSION = /\.(?:avif|gif|heic|heif|hif|jpe?g|png|webp)$/i;
const LOCAL_PREVIEW_EXTENSION = /\.(?:heif|hif)$/i;
const PREVIEW_PREFIX = '_previews/';
const DISPLAY_PREFIX = '_display/';
const WORKER_BASE_URL = 'https://photo-catalog.lutin-account.workers.dev';

function encodeKey(key) {
	return key.split('/').map(encodeURIComponent).join('/');
}

function allowedOrigin(request, env) {
	const origin = request.headers.get('Origin');
	const allowedOrigins = (env.CORS_ALLOW_ORIGINS || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return origin && allowedOrigins.includes(origin) ? origin : undefined;
}

function corsHeaders(request, env) {
	const allowOrigin = allowedOrigin(request, env);
	return {
		...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Accept',
		Vary: 'Origin',
	};
}

function cacheKeyFor(request, env) {
	const url = new URL(request.url);
	url.searchParams.set('__cors', allowedOrigin(request, env) || 'none');
	return new Request(url, { method: 'GET' });
}

function json(value, request, env, init = {}) {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json; charset=utf-8');
	Object.entries(corsHeaders(request, env)).forEach(([name, content]) => headers.set(name, content));
	return new Response(JSON.stringify(value), { ...init, headers });
}

async function listPhotos(request, env, ctx) {
	const cache = caches.default;
	const cacheKey = cacheKeyFor(request, env);
	const cached = await cache.match(cacheKey);
	if (cached) return cached;

	const prefix = env.PHOTO_PREFIX ?? 'photos/';
	const objects = [];
	let cursor;

	do {
		const page = await env.PHOTOS.list({ prefix, cursor, limit: 1000 });
		objects.push(...page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);

	const requestUrl = new URL(request.url);
	const publicBase = env.PUBLIC_BASE_URL?.replace(/\/$/, '');
	const workerBase = WORKER_BASE_URL;
	const photos = objects
		.filter(
			(object) =>
				!object.key.startsWith(PREVIEW_PREFIX) &&
				!object.key.startsWith(DISPLAY_PREFIX) &&
				IMAGE_EXTENSION.test(object.key),
		)
		.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime())
		.map((object) => {
			const relativeKey = object.key.slice(prefix.length);
			const version = encodeURIComponent(object.etag);
			return {
				key: object.key,
				url: publicBase
					? `${publicBase}/${encodeKey(object.key)}`
					: `${requestUrl.origin}/photos/${encodeKey(relativeKey)}`,
				previewUrl: `${workerBase}/preview/${encodeKey(relativeKey)}?v=${version}`,
				displayUrl: `${workerBase}/display/${encodeKey(relativeKey)}?v=${version}`,
				downloadUrl: `${workerBase}/download/${encodeKey(relativeKey)}?v=${version}`,
				uploaded: object.uploaded.toISOString(),
				size: object.size,
			};
		});

	const response = json(
		{ photos, generatedAt: new Date().toISOString() },
		request,
		env,
		{ headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
	);
	ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
}

async function getPhoto(request, pathname, env) {
	let relativeKey;
	try {
		relativeKey = decodeURIComponent(pathname.slice('/photos/'.length));
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const prefix = env.PHOTO_PREFIX ?? 'photos/';
	const key = `${prefix}${relativeKey}`;
	if (!relativeKey || !IMAGE_EXTENSION.test(key)) {
		return new Response('Not found', { status: 404 });
	}

	const object = await env.PHOTOS.get(key);
	if (!object) return new Response('Not found', { status: 404 });

	const headers = new Headers(corsHeaders(request, env));
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=86400, immutable');
	return new Response(object.body, { headers });
}

async function getPreview(request, pathname, env, ctx) {
	const cache = caches.default;
	const cacheKey = cacheKeyFor(request, env);
	const cached = await cache.match(cacheKey);
	if (cached) return cached;

	let relativeKey;
	try {
		relativeKey = decodeURIComponent(pathname.slice('/preview/'.length));
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const prefix = env.PHOTO_PREFIX ?? 'photos/';
	const key = `${prefix}${relativeKey}`;
	if (!relativeKey || !IMAGE_EXTENSION.test(key)) {
		return new Response('Not found', { status: 404 });
	}
	if (LOCAL_PREVIEW_EXTENSION.test(key)) {
		const preview = await env.PHOTOS.get(`${prefix}${PREVIEW_PREFIX}${relativeKey}.jpg`);
		if (!preview) {
			return new Response('Preview missing. Run pnpm photos:sync.', { status: 404 });
		}

		const headers = new Headers(corsHeaders(request, env));
		preview.writeHttpMetadata(headers);
		headers.set('Content-Type', 'image/jpeg');
		headers.set('etag', preview.httpEtag);
		headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
		const response = new Response(preview.body, { headers });
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	}

	const object = await env.PHOTOS.get(key);
	if (!object) return new Response('Not found', { status: 404 });

	const transformed = (
		await env.IMAGES.input(object.body)
			.transform({ width: 640, height: 480, fit: 'cover' })
			.output({ format: 'image/webp', quality: 78, anim: false })
	).response();
	const headers = new Headers(transformed.headers);
	Object.entries(corsHeaders(request, env)).forEach(([name, content]) => headers.set(name, content));
	headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
	const response = new Response(transformed.body, { status: transformed.status, headers });
	if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
}

async function getDisplay(request, pathname, env, ctx) {
	const cache = caches.default;
	const cacheKey = cacheKeyFor(request, env);
	const cached = await cache.match(cacheKey);
	if (cached) return cached;

	let relativeKey;
	try {
		relativeKey = decodeURIComponent(pathname.slice('/display/'.length));
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const prefix = env.PHOTO_PREFIX ?? 'photos/';
	const key = `${prefix}${relativeKey}`;
	if (!relativeKey || !IMAGE_EXTENSION.test(key)) {
		return new Response('Not found', { status: 404 });
	}

	if (LOCAL_PREVIEW_EXTENSION.test(key)) {
		const display = await env.PHOTOS.get(`${prefix}${DISPLAY_PREFIX}${relativeKey}.jpg`);
		if (!display) {
			return new Response('Display image missing. Run pnpm photos:sync.', { status: 404 });
		}
		const headers = new Headers(corsHeaders(request, env));
		display.writeHttpMetadata(headers);
		headers.set('Content-Type', 'image/jpeg');
		headers.set('etag', display.httpEtag);
		headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
		const response = new Response(display.body, { headers });
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	}

	const object = await env.PHOTOS.get(key);
	if (!object) return new Response('Not found', { status: 404 });
	const transformed = (
		await env.IMAGES.input(object.body)
			.transform({ width: 2400, height: 2400, fit: 'scale-down' })
			.output({ format: 'image/webp', quality: 88, anim: false })
	).response();
	const headers = new Headers(transformed.headers);
	Object.entries(corsHeaders(request, env)).forEach(([name, content]) => headers.set(name, content));
	headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
	const response = new Response(transformed.body, { status: transformed.status, headers });
	if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
	return response;
}

async function downloadPhoto(request, pathname, env) {
	let relativeKey;
	try {
		relativeKey = decodeURIComponent(pathname.slice('/download/'.length));
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const prefix = env.PHOTO_PREFIX ?? 'photos/';
	const key = `${prefix}${relativeKey}`;
	if (!relativeKey || !IMAGE_EXTENSION.test(key)) {
		return new Response('Not found', { status: 404 });
	}
	const object = await env.PHOTOS.get(key);
	if (!object) return new Response('Not found', { status: 404 });

	const filename = relativeKey.split('/').pop()?.replace(/["\r\n]/g, '_') || 'photo';
	const headers = new Headers(corsHeaders(request, env));
	object.writeHttpMetadata(headers);
	headers.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
	headers.set('Content-Length', object.size.toString());
	headers.set('etag', object.httpEtag);
	return new Response(object.body, { headers });
}

export default {
	async fetch(request, env, ctx) {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) });
		}
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

		const { pathname } = new URL(request.url);
		if (pathname === '/catalog.json') return listPhotos(request, env, ctx);
		if (pathname.startsWith('/preview/')) return getPreview(request, pathname, env, ctx);
		if (pathname.startsWith('/display/')) return getDisplay(request, pathname, env, ctx);
		if (pathname.startsWith('/download/')) return downloadPhoto(request, pathname, env);
		if (pathname.startsWith('/photos/')) return getPhoto(request, pathname, env);
		return new Response('Not found', { status: 404 });
	},
};
