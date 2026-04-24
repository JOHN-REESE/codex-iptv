const { Buffer } = require("node:buffer");

const DEFAULT_HEADERS = {
  Referer: "https://news.hbtv.com.cn/",
  Origin: "https://news.hbtv.com.cn",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};

const ALLOWED_HOSTS = new Set([
  "live21-cjy.hbtv.com.cn",
  "news.hbtv.com.cn",
  "m.hbtv.com.cn",
]);

const CHANNEL_STREAM_KEYS = {
  hubeiws: "new-hbws",
  hubeijs: "new-hbjs",
  hubeizh: "new-hbzh",
  hubeiys: "new-hbys",
  hubeish: "new-hbsh",
  hubeijy: "new-hbjy",
  longshang: "new-hbls",
};

const LIVE_PAGE_URL = "https://news.hbtv.com.cn/app/tv/431";

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

function toAbsoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function toProxyUrl(req, targetUrl) {
  return `${getBaseUrl(req)}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
}

function rewriteM3u8(req, body, baseUrl) {
  const rewriteAttributeUris = body.replace(
    /URI="([^"]+)"/g,
    (_, value) => {
      const absoluteUrl = toAbsoluteUrl(value, baseUrl);
      return absoluteUrl ? `URI="${toProxyUrl(req, absoluteUrl)}"` : `URI="${value}"`;
    }
  );

  return rewriteAttributeUris
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      const absoluteUrl = toAbsoluteUrl(trimmed, baseUrl);
      return absoluteUrl ? toProxyUrl(req, absoluteUrl) : line;
    })
    .join("\n");
}

async function resolveChannelStream(channelId) {
  const streamKey = CHANNEL_STREAM_KEYS[channelId];
  if (!streamKey) {
    return null;
  }

  const page = await fetch(LIVE_PAGE_URL, {
    headers: DEFAULT_HEADERS,
    redirect: "follow",
  });

  if (!page.ok) {
    throw new Error(`Failed to load source page: ${page.status}`);
  }

  const html = await page.text();
  const escapedKey = streamKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `"(https://live21-cjy\\.hbtv\\.com\\.cn/new-hbtv/${escapedKey}\\.m3u8\\?auth_key=[^"]+)"`,
    "i"
  );
  const match = html.match(regex);
  return match ? match[1] : null;
}

module.exports = async function handler(req, res) {
  const target = req.query.url;
  const channel = req.query.channel;

  let resolvedTarget = target;

  if (!resolvedTarget && channel && !Array.isArray(channel)) {
    try {
      resolvedTarget = await resolveChannelStream(channel);
    } catch (error) {
      res.status(502).json({ error: "Failed to resolve channel stream.", detail: String(error) });
      return;
    }
  }

  if (!resolvedTarget || Array.isArray(resolvedTarget)) {
    res.status(400).json({ error: "Missing url or channel query parameter." });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(resolvedTarget);
  } catch {
    res.status(400).json({ error: "Invalid target url." });
    return;
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    res.status(403).json({ error: "Target host is not allowed." });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: DEFAULT_HEADERS,
      redirect: "follow",
    });
  } catch (error) {
    res.status(502).json({ error: "Upstream request failed.", detail: String(error) });
    return;
  }

  if (!upstream.ok) {
    res.status(upstream.status).send(await upstream.text());
    return;
  }

  const finalUrl = upstream.url || targetUrl.toString();
  const contentType = upstream.headers.get("content-type") || "";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (contentType.includes("application/vnd.apple.mpegurl") || finalUrl.includes(".m3u8")) {
    const manifest = await upstream.text();
    const rewritten = rewriteM3u8(req, manifest, finalUrl);
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.status(200).send(rewritten);
    return;
  }

  const arrayBuffer = await upstream.arrayBuffer();
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
  res.status(200).send(Buffer.from(arrayBuffer));
};
