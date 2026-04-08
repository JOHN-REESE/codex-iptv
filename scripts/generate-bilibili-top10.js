#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const BILIBILI_REFERER = "https://live.bilibili.com/";
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const args = {
    limit: 10,
    output: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === "limit") {
      args.limit = Number(value);
    } else if (key === "output") {
      args.output = value;
    }

    index += 1;
  }

  return args;
}

function formatOnlineCount(value) {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万`;
  }
  return String(value);
}

function escapeAttribute(value) {
  return String(value).replace(/"/g, "'");
}

async function fetchTopRooms(limit) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    extraHTTPHeaders: {
      "user-agent": BILIBILI_USER_AGENT,
      referer: BILIBILI_REFERER
    }
  });

  let payload = null;

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/xlive/web-interface/v1/index/getList")) {
      return;
    }

    try {
      payload = JSON.parse(await response.text());
    } catch {
      // Ignore transient parse errors and keep listening.
    }
  });

  try {
    await page.goto(BILIBILI_REFERER, {
      waitUntil: "networkidle",
      timeout: 45000
    });
    await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }

  if (!payload || !payload.data) {
    throw new Error("Could not load the Bilibili homepage room list.");
  }

  const rooms = [];
  const { recommend_room_list: recommendRooms = [], room_list: roomModules = [] } = payload.data;

  recommendRooms.forEach((room) => rooms.push(room));
  roomModules.forEach((module) => {
    (module.list || []).forEach((room) => rooms.push(room));
  });

  const uniq = new Map();
  rooms.forEach((room) => {
    const roomId = room.roomid || room.room_id;
    if (!roomId) {
      return;
    }

    const online = Number(room.online || 0);
    const previous = uniq.get(roomId);
    if (previous && previous.online >= online) {
      return;
    }

    const areaParent = room.area_v2_parent_name || "";
    const areaChild = room.area_v2_name || room.area_name || "";
    const area = areaParent && areaChild ? `${areaParent}/${areaChild}` : areaChild || areaParent;

    uniq.set(roomId, {
      roomId,
      title: room.title || `Room ${roomId}`,
      uname: room.uname || `Room ${roomId}`,
      area,
      online,
      livePage: `https://live.bilibili.com/${roomId}`
    });
  });

  return Array.from(uniq.values())
    .sort((left, right) => right.online - left.online)
    .slice(0, limit);
}

function selectStableStream(playInfo) {
  const streamList = playInfo?.data?.playurl_info?.playurl?.stream || [];
  const candidates = [];

  streamList.forEach((stream) => {
    const protocolName = stream.protocol_name || "";
    (stream.format || []).forEach((format) => {
      const formatName = format.format_name || "";
      (format.codec || []).forEach((codec) => {
        if (!codec.base_url || !Array.isArray(codec.url_info) || codec.url_info.length === 0) {
          return;
        }

        codec.url_info.forEach((urlInfo, index) => {
          if (!urlInfo?.host) {
            return;
          }

          const fullUrl = `${urlInfo.host}${codec.base_url}${urlInfo.extra || ""}`;
          const score =
            (protocolName === "http_hls" ? 1000 : 0) +
            (formatName === "ts" ? 200 : 0) +
            (codec.codec_name === "avc" ? 100 : 0) +
            (codec.current_qn === 400 ? 40 : 0) +
            (codec.current_qn === 250 ? 35 : 0) +
            (codec.current_qn === 150 ? 20 : 0) +
            (/bilivideo\.com/.test(urlInfo.host) ? 10 : 0) -
            index;

          candidates.push({
            url: fullUrl,
            score,
            protocolName,
            formatName,
            codecName: codec.codec_name || "",
            qn: codec.current_qn || 0
          });
        });
      });
    });
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

async function fetchStableStream(roomId) {
  const requestUrl =
    "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo" +
    `?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1,2&qn=400&platform=web&ptype=8`;

  const response = await fetch(requestUrl, {
    headers: {
      referer: BILIBILI_REFERER,
      "user-agent": BILIBILI_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Play info request failed with ${response.status}`);
  }

  const payload = await response.json();
  const selected = selectStableStream(payload);
  if (!selected) {
    throw new Error("No playable HLS stream found.");
  }

  return selected;
}

async function writePlaylist(outputPath, rooms) {
  const lines = ["#EXTM3U"];

  rooms.forEach((room, index) => {
    const label =
      `${index + 1}. ${room.uname} - ${room.title}` +
      ` [${room.area || "Bilibili"} | ${formatOnlineCount(room.online)}]`;

    lines.push(`#EXTINF:-1 group-title="Bilibili Top 10" tvg-name="${escapeAttribute(room.uname)}",${label}`);
    lines.push(`#EXTVLCOPT:http-referrer=${BILIBILI_REFERER}`);
    lines.push(`#EXTVLCOPT:http-user-agent=${BILIBILI_USER_AGENT}`);
    lines.push(`#EXTVLCOPT:http-origin=https://live.bilibili.com`);
    lines.push(room.stream.url);
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  const outputPath = path.resolve(
    process.cwd(),
    args.output || path.join(process.env.HOME || process.cwd(), "Desktop", `bilibili-top10-stable-${timestamp}.m3u8`)
  );

  const topRooms = await fetchTopRooms(args.limit);
  const enrichedRooms = [];

  for (const room of topRooms) {
    try {
      const stream = await fetchStableStream(room.roomId);
      enrichedRooms.push({ ...room, stream });
    } catch (error) {
      console.error(`Skip room ${room.roomId}: ${error.message}`);
    }
  }

  if (enrichedRooms.length === 0) {
    throw new Error("No playable streams were resolved for the current top rooms.");
  }

  await writePlaylist(outputPath, enrichedRooms);

  console.log(`Saved ${enrichedRooms.length} rooms to ${outputPath}`);
  enrichedRooms.forEach((room, index) => {
    console.log(
      `${index + 1}. ${room.uname} | ${room.online} | ${room.stream.protocolName}/${room.stream.formatName}/${room.stream.codecName} qn=${room.stream.qn}`
    );
    console.log(`   ${room.livePage}`);
    console.log(`   ${room.stream.url}`);
  });
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
