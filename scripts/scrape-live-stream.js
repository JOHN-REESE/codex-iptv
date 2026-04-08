#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

function printHelp() {
  console.log(`
Usage:
  node scripts/scrape-live-stream.js --url <page-url> [options]

Options:
  --url <url>         Webpage to inspect for live stream URLs.
  --name <name>       Channel name used in the generated playlist.
  --output <path>     Output playlist path. Default: output/<hostname>.m3u8
  --timeout <ms>      Navigation timeout in milliseconds. Default: 45000
  --delay <ms>        Extra wait time after the page loads. Default: 8000
  --wait-for <sel>    Wait for a selector before collecting network traffic.
  --help              Show this help message.

Example:
  node scripts/scrape-live-stream.js \\
    --url https://example.com/live \\
    --name "Example Live" \\
    --output output/example-live.m3u8
`.trim());
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);

    if (key === "help") {
      args.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function decodeEscapedString(value) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/^['"]|['"]$/g, "");
}

function cleanCandidate(rawValue, baseUrl) {
  const decoded = decodeEscapedString(rawValue.trim());

  if (!decoded) {
    return null;
  }

  try {
    const absoluteUrl = new URL(decoded, baseUrl).toString();
    if (!absoluteUrl.startsWith("http://") && !absoluteUrl.startsWith("https://")) {
      return null;
    }

    return absoluteUrl;
  } catch {
    return null;
  }
}

function isLikelyStreamUrl(candidate) {
  return (
    /\.m3u8(\?|$)/i.test(candidate) ||
    /playlist\.m3u/i.test(candidate) ||
    /manifest/i.test(candidate) ||
    /hls/i.test(candidate)
  );
}

function collectUrlsFromText(text, baseUrl) {
  const matches = new Set();
  const patterns = [
    /https?:\/\/[^"'`\s<>()\\]+/gi,
    /\/[^"'`\s<>()\\]+\.m3u8(?:\?[^"'`\s<>()\\]*)?/gi,
    /https?:\\\/\\\/[^"'`\s<>()]+/gi
  ];

  for (const pattern of patterns) {
    const results = text.match(pattern) || [];
    for (const result of results) {
      const candidate = cleanCandidate(result, baseUrl);
      if (candidate && isLikelyStreamUrl(candidate)) {
        matches.add(candidate);
      }
    }
  }

  return matches;
}

function collectUrlsFromJsonValue(value, baseUrl, matches = new Set()) {
  if (typeof value === "string") {
    const candidate = cleanCandidate(value, baseUrl);
    if (candidate && isLikelyStreamUrl(candidate)) {
      matches.add(candidate);
    }
    return matches;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsFromJsonValue(item, baseUrl, matches));
    return matches;
  }

  if (!value || typeof value !== "object") {
    return matches;
  }

  if (typeof value.base_url === "string" && Array.isArray(value.url_info)) {
    value.url_info.forEach((urlInfo) => {
      if (!urlInfo || typeof urlInfo !== "object") {
        return;
      }

      const host = typeof urlInfo.host === "string" ? urlInfo.host : null;
      const extra = typeof urlInfo.extra === "string" ? urlInfo.extra : "";
      if (!host) {
        return;
      }
      const combined = `${host}${value.base_url}${extra}`;
      const candidate = cleanCandidate(combined, baseUrl);
      if (candidate && isLikelyStreamUrl(candidate)) {
        matches.add(candidate);
      }
    });
  }

  Object.values(value).forEach((child) => collectUrlsFromJsonValue(child, baseUrl, matches));
  return matches;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "live-stream";
}

function finalizePlaylistEntries(urls) {
  const normalized = Array.from(new Set(urls)).filter(
    (url) => !url.includes("/xlive/web-room/") && !url.includes("api.geetest.com")
  );

  const directCdnUrls = normalized.filter((url) => url.includes("bilivideo.com"));
  if (directCdnUrls.length > 0) {
    return directCdnUrls.sort();
  }

  return normalized.sort();
}

async function writePlaylist({ outputPath, channelName, urls }) {
  const lines = ["#EXTM3U"];

  urls.forEach((url, index) => {
    lines.push(`#EXTINF:-1,${channelName} ${index + 1}`);
    lines.push(url);
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.url) {
    throw new Error("The --url option is required.");
  }

  const targetUrl = args.url;
  const timeout = Number(args.timeout || 45000);
  const delay = Number(args.delay || 8000);
  const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
  const channelName = args.name || hostname;
  const outputPath = path.resolve(
    process.cwd(),
    args.output || `output/${slugify(hostname)}.m3u8`
  );
  const streamUrls = new Set();

  const captureUrl = (candidate) => {
    const cleaned = cleanCandidate(candidate, targetUrl);
    if (cleaned && isLikelyStreamUrl(cleaned)) {
      streamUrls.add(cleaned);
    }
  };

  captureUrl(targetUrl);

  try {
    const response = await fetch(targetUrl);
    if (response.ok) {
      captureUrl(response.url);
      const responseText = await response.text();
      collectUrlsFromText(responseText, response.url).forEach((url) => streamUrls.add(url));
      try {
        collectUrlsFromJsonValue(JSON.parse(responseText), response.url).forEach((url) =>
          streamUrls.add(url)
        );
      } catch {
        // Ignore non-JSON payloads.
      }
    }
  } catch {
    // Some pages block direct fetches, so browser-based collection remains the fallback.
  }

  if (streamUrls.size === 0) {
    let browser;

    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      page.on("request", (request) => {
        captureUrl(request.url());
      });

      page.on("response", async (response) => {
        captureUrl(response.url());

        const contentType = response.headers()["content-type"] || "";
        const isTextPayload =
          contentType.includes("text") ||
          contentType.includes("json") ||
          contentType.includes("javascript") ||
          contentType.includes("application/x-mpegurl");

        if (!isTextPayload) {
          return;
        }

        try {
          const body = await response.text();
          collectUrlsFromText(body, response.url()).forEach((url) => streamUrls.add(url));
          try {
            collectUrlsFromJsonValue(JSON.parse(body), response.url()).forEach((url) =>
              streamUrls.add(url)
            );
          } catch {
            // Ignore non-JSON payloads.
          }
        } catch {
          // Ignore bodies that cannot be read, such as opaque or binary responses.
        }
      });

      await page.goto(targetUrl, {
        waitUntil: "networkidle",
        timeout
      });

      if (args["wait-for"]) {
        await page.waitForSelector(args["wait-for"], { timeout }).catch(() => {});
      }

      await page.waitForTimeout(delay);

      collectUrlsFromText(await page.content(), page.url()).forEach((url) => streamUrls.add(url));

      for (const frame of page.frames()) {
        collectUrlsFromText(await frame.content(), frame.url() || page.url()).forEach((url) =>
          streamUrls.add(url)
        );
      }
    } catch (error) {
      if (streamUrls.size === 0) {
        throw new Error(
          `${error.message}\nInstall the browser runtime with: npx playwright install chromium`
        );
      }
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  const playlistEntries = finalizePlaylistEntries(streamUrls);

  if (playlistEntries.length === 0) {
    throw new Error(
      "No stream URLs were found. Try increasing --delay or using --wait-for for sites that load the player later."
    );
  }

  await writePlaylist({
    outputPath,
    channelName,
    urls: playlistEntries
  });

  console.log(`Saved ${playlistEntries.length} stream URL(s) to ${outputPath}`);
  playlistEntries.forEach((entry) => console.log(entry));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
