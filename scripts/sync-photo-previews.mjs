import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CATALOG_URL = 'https://photo-catalog.lutin-account.workers.dev/catalog.json';
const BUCKET = 'photos';
const PREVIEW_PREFIX = '_previews/';
const HIF_EXTENSION = /\.(?:heif|hif)$/i;
const DRY_RUN = process.argv.includes('--dry-run');

function requireCommand(command) {
	try {
		execFileSync(command, ['-version'], { stdio: 'ignore' });
	} catch {
		throw new Error(`${command} is required. Install it with: brew install ffmpeg`);
	}
}

function previewStream(file) {
	const output = execFileSync(
		'ffprobe',
		['-v', 'error', '-show_streams', '-of', 'json', file],
		{ encoding: 'utf8' },
	);
	const streams = JSON.parse(output).streams.filter((stream) => stream.codec_type === 'video');
	const independent = streams.filter(
		(stream) => stream.disposition?.dependent !== 1 && stream.codec_name !== 'mjpeg',
	);
	const candidates = independent.length > 0 ? independent : streams;
	const selected = candidates.sort(
		(a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
	)[0];
	if (!selected) throw new Error('No image stream found');
	return selected.index;
}

function makePreview(source, destination) {
	const stream = previewStream(source);
	execFileSync(
		'ffmpeg',
		[
			'-hide_banner',
			'-loglevel',
			'error',
			'-y',
			'-i',
			source,
			'-map',
			`0:${stream}`,
			'-frames:v',
			'1',
			'-vf',
			'scale=640:480:force_original_aspect_ratio=increase,crop=640:480',
			'-c:v',
			'mjpeg',
			'-q:v',
			'3',
			destination,
		],
		{ stdio: 'inherit' },
	);
}

function uploadPreview(key, file) {
	const result = spawnSync(
		'npx',
		[
			'--yes',
			'wrangler',
			'r2',
			'object',
			'put',
			`${BUCKET}/${PREVIEW_PREFIX}${key}.jpg`,
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
requireCommand('ffprobe');

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
	const existing = await fetch(previewUrl);
	if (existing.ok) {
		console.log(`✓ ${photo.key} already has a preview`);
		continue;
	}

	const directory = mkdtempSync(join(tmpdir(), 'lutin-photo-preview-'));
	try {
		console.log(`Creating preview for ${photo.key}…`);
		const original = await fetch(photo.url);
		if (!original.ok) throw new Error(`Could not download ${photo.key}: ${original.status}`);
		const source = join(directory, 'source.hif');
		const preview = join(directory, 'preview.jpg');
		writeFileSync(source, Buffer.from(await original.arrayBuffer()));
		makePreview(source, preview);
		if (!DRY_RUN) uploadPreview(photo.key, preview);
		created += 1;
		console.log(`${DRY_RUN ? '✓ validated' : '✓'} ${photo.key}`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

console.log(
	created > 0
		? `${DRY_RUN ? 'Validated' : 'Created'} ${created} preview${created === 1 ? '' : 's'}.`
		: 'All previews are current.',
);
