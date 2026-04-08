# codex-iptv

Scrape live stream URLs from webpages and export them as M3U8 playlists.

## Included Files

- `scripts/scrape-live-stream.js`: Scrape live stream URLs from a webpage and generate an `.m3u8` file.
- `scripts/generate-bilibili-top10.js`: Generate a desktop-ready playlist for the current Bilibili top 10 live rooms with stable HLS links.
- `dist/codex-iptv-scripts.tar.gz`: Packaged archive of the current scripts and project files.

## Install

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run sniff -- --url https://example.com/live --name "Example Live"
```

```bash
npm run bili-top10
```

The Bilibili generator writes a playlist to the desktop by default.
