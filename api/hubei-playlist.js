const CHANNELS = [
  {
    id: "hubeiws",
    name: "湖北卫视",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbws.png",
  },
  {
    id: "hubeijs",
    name: "湖北经视",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbjs.png",
  },
  {
    id: "hubeizh",
    name: "湖北综合",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbzh.png",
  },
  {
    id: "hubeiys",
    name: "湖北影视",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbys.png",
  },
  {
    id: "hubeish",
    name: "湖北生活",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbsh.png",
  },
  {
    id: "hubeijy",
    name: "湖北教育",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/hbjy.png",
  },
  {
    id: "longshang",
    name: "垄上频道",
    logo: "https://m.hbtv.com.cn/t/site/10008/6fd52b21978e4534397ad7bea6ec6b0d/assets/2023_live_audio/images/live/lspd.png",
  },
];

module.exports = function handler(req, res) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const baseUrl = `${proto}://${req.headers.host}`;
  const lines = ['#EXTM3U x-tvg-url=""', ""];

  for (const channel of CHANNELS) {
    lines.push(
      `#EXTINF:-1 tvg-id="${channel.id}" tvg-name="${channel.name}" tvg-logo="${channel.logo}" group-title="湖北地方台",${channel.name}`
    );
    lines.push(`${baseUrl}/api/proxy?channel=${encodeURIComponent(channel.id)}`);
    lines.push("");
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  res.status(200).send(lines.join("\n"));
};
