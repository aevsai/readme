# Astro Starter Kit: Blog

```sh
pnpm create astro@latest -- --template blog
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

Features:

- ✅ Minimal styling (make it your own!)
- ✅ 100/100 Lighthouse performance
- ✅ SEO-friendly with canonical URLs and Open Graph data
- ✅ Sitemap support
- ✅ RSS Feed support
- ✅ Markdown & MDX support

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX documents. Use `getCollection()` to retrieve posts from `src/content/blog/`, and type-check your frontmatter using an optional schema. See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/) to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `pnpm install`             | Installs dependencies                            |
| `pnpm dev`             | Starts local dev server at `localhost:4321`      |
| `pnpm build`           | Build your production site to `./dist/`          |
| `pnpm preview`         | Preview your build locally, before deploying     |
| `pnpm astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `pnpm astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Check out [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## Credit

This theme is based off of the lovely [Bear Blog](https://github.com/HermanMartinus/bearblog/).

## R2 photo catalog

The home page can discover and render images from a Cloudflare R2 bucket at runtime. New uploads appear without rebuilding the Astro site (the catalog is cached for up to five minutes). The Worker generates cached 640×480 WebP previews through Cloudflare Images, so the grid never downloads the full originals.

1. Upload catalog images to the `photos` R2 bucket. JPEG, PNG, WebP, AVIF, GIF, HEIC, HEIF, and Sony HIF files are discovered automatically.
2. Deploy the already-configured Worker with `npx wrangler deploy -c wrangler.r2-catalog.jsonc`. The account ID and `photos` bucket from the R2 S3 address are hardcoded in this file; no S3 credentials are needed.
3. Rebuild the site. The deployed `https://photo-catalog.lutin-account.workers.dev/catalog.json` endpoint is hardcoded in the photo component.

Full-size catalog links point to the bucket's `https://cdn.aevsai.me` custom domain, while previews continue through the resizing Worker. The Images binding accepts originals up to 20 MB. `PHOTO_PREFIX` can be set if the catalog moves into a folder, and `CORS_ALLOW_ORIGINS` is a comma-separated allowlist of site origins.

### Sony HIF previews

Cloudflare Images cannot decode the Sony 10-bit HIF variant. After uploading HIF files directly to R2, run:

```sh
pnpm photos:sync
```

This requires `ffmpeg` (`brew install ffmpeg`). It discovers HIF files through the catalog, creates 640×480 catalog previews and 2400px popup renditions locally, then uploads them under `_previews/` and `_display/`. Existing renditions are skipped. The popup includes a separate download link that returns the untouched original. Redeploy the Worker after changing its code; future photo uploads only require running the sync command.
