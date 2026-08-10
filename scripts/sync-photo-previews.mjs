import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CATALOG_URL = 'https://photo-catalog.lutin-account.workers.dev/catalog.json';
const BUCKET = 'photos';
const PREVIEW_PREFIX = '_previews/';
const DISPLAY_PREFIX = '_display/';
const HIF_EXTENSION = /\.(?:heif|hif)$/i;
const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD_PREVIEWS = process.argv.includes('--rebuild-previews');

function requireCommand(command) {
	try {
		execFileSync(command, ['-version'], { stdio: 'ignore' });
	} catch {
		throw new Error(`${command} is required. Install it with: brew install ffmpeg`);
	}
}

function decode(source, destination) {
	execFileSync(
		'ffmpeg',
		[
			'-hide_banner', '-loglevel', 'error', '-y', '-i', source,
			'-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2', destination,
		],
		{ stdio: 'inherit' },
	);
}

function makePreview(source, destination) {
	execFileSync(
		'ffmpeg',
		[
			'-hide_banner', '-loglevel', 'error', '-y', '-i', source,
			'-frames:v', '1', '-vf',
			'scale=640:480:force_original_aspect_ratio=increase,crop=640:480',
			'-c:v', 'mjpeg', '-q:v', '3', destination,
		],
		{ stdio: 'inherit' },
	);
}

function makeDisplay(source, destination) {
	execFileSync(
		'ffmpeg',
		[
			'-hide_banner', '-loglevel', 'error', '-y', '-i', source,
			'-frames:v', '1', '-vf',
			'scale=2400:2400:force_original_aspect_ratio=decrease',
			'-c:v', 'mjpeg', '-q:v', '3', destination,
		],
		{ stdio: 'inherit' },
	);
}

function uploadRendition(prefix, key, file) {
	const result = spawnSync(
		'npx',
		[
			'--yes',
			'wrangler',
			'r2',
			'object',
			'put',
			`${BUCKET}/${prefix}${key}.jpg`,
			'--remote',
			'--file',
			file,
			'--content-type',
			'image/jpeg',
			'--cache-control',
			'public, max-age=31536000, immutable',
			'--force',
		],
		{ stdio: 'inherit' },
	);
	if (result.status !== 0) throw new Error(`Upload failed for ${key}`);
}

requireCommand('ffmpeg');

const response = await fetch(`${CATALOG_URL}?sync=${Date.now()}`);
if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
const { photos = [] } = await response.json();
const hifPhotos = photos.filter((photo) => HIF_EXTENSION.test(photo.key));

if (hifPhotos.length === 0) {
	console.log('No HIF photos need previews.');
	process.exit(0);
}

let created = 0;
for (const photo of hifPhotos) {
	const previewUrl = new URL(photo.previewUrl);
	previewUrl.protocol = 'https:';
	previewUrl.searchParams.set('syncCheck', Date.now().toString());
	const displayUrl = new URL(
		photo.displayUrl || `https://photo-catalog.lutin-account.workers.dev/display/${encodeURIComponent(photo.key)}`,
	);
	displayUrl.protocol = 'https:';
	displayUrl.searchParams.set('syncCheck', Date.now().toString());
	const [hasPreview, displayExists] = await Promise.all([
		fetch(previewUrl).then((result) => result.ok),
		fetch(displayUrl).then((result) => result.ok),
	]);
	const previewExists = hasPreview && !REBUILD_PREVIEWS;
	if (previewExists && displayExists) {
		console.log(`✓ ${photo.key} already has both renditions`);
		continue;
	}

	const directory = mkdtempSync(join(tmpdir(), 'lutin-photo-preview-'));
	try {
		console.log(`Creating renditions for ${photo.key}…`);
		const original = await fetch(photo.downloadUrl || photo.url);
		if (!original.ok) throw new Error(`Could not download ${photo.key}: ${original.status}`);
		const source = join(directory, 'source.hif');
		const decoded = join(directory, 'decoded.jpg');
		const preview = join(directory, 'preview.jpg');
		const display = join(directory, 'display.jpg');
		writeFileSync(source, Buffer.from(await original.arrayBuffer()));
		decode(source, decoded);
		if (!previewExists) {
			makePreview(decoded, preview);
			if (!DRY_RUN) uploadRendition(PREVIEW_PREFIX, photo.key, preview);
		}
		if (!displayExists) {
			makeDisplay(decoded, display);
			if (!DRY_RUN) uploadRendition(DISPLAY_PREFIX, photo.key, display);
		}
		created += 1;
		console.log(`${DRY_RUN ? '✓ validated' : '✓'} ${photo.key}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

console.log(
	created > 0
			? `${DRY_RUN ? 'Validated' : 'Created'} renditions for ${created} photo${created === 1 ? '' : 's'}.`
		: 'All previews are current.',
);
