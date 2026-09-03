const axios = require("axios");
const crypto = require("node:crypto");

/* ================= Pluto TV ================= */

const PLUTO_API = "https://api.pluto.tv/v2/channels";
const CACHE_TTL_MS = 10 * 60 * 1000;
let plutoCache = { ts: 0, data: null, error: null };

// Categorias aceptadas (nombres por region; el API puede variar)
const PLUTO_CAT_WHITELIST = new Set(["Deportes", "Animé & Gaming", "Anime", "Noticias"]);

// Slugs verificados 2026-09-03 (filtro estable si cambian las categorias)
const PLUTO_SLUG_WHITELIST = new Set([
  // deportes
  "pluto-tv-peleas", "futbol", "itv-deportes", "pfl-mma", "azteca-deportes-network", "fifa",
  "red-bull-tv-ptv1", "realmadrid-tv-ptv1", "top-barca", "ufc-ptv1", "nfl-channel-ptv1",
  // anime / gaming
  "pluto-tv-anime", "naruto-1", "one-piece-ptv1", "naruto-shippuden-ptv2",
  "boruto-naruto-next-generations", "death-note-ptv1", "captain-tsubasa", "hunter-x-hunter-ptv1",
  "inuyasha", "jojos-bizarre-adventure", "yu-gi-oh-pvt1", "tokusato", "pokemon-ptv1",
  "pluto-tv-e-sports",
  // noticias
  "euronews-espanol", "cbs-news-ptv1", "teleformula", "milenio-television", "c4-en-alerta",
  "rcn-noticias",
]);

function plutoQuery() {
  const u = () => crypto.randomUUID();
  return {
    deviceType: "web",
    appName: "web",
    appVersion: "6.11.0",
    deviceMake: "Chrome",
    deviceModel: "web",
    deviceId: u(),
    sid: u(),
    advertisingId: u(),
  };
}

function normalizeCategory(cat) {
  const c = String(cat || "").toLowerCase();
  if (c.includes("deporte") || c.includes("sport")) return "deportes";
  if (c.includes("anime") || c.includes("animé") || c.includes("anime & gaming")) return "anime";
  if (c.includes("noticia") || c.includes("news")) return "noticias";
  return "otras";
}

async function fetchPlutoChannels() {
  const now = Date.now();
  if (plutoCache.data && now - plutoCache.ts < CACHE_TTL_MS) return plutoCache.data;
  try {
    const res = await axios.get(PLUTO_API, {
      params: plutoQuery(),
      timeout: 25000,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
    });
    const raw = Array.isArray(res.data) ? res.data : [];
    const channels = raw
      .filter((c) => {
        const cat = normalizeCategory(c.category);
        return PLUTO_SLUG_WHITELIST.has(String(c.slug || "")) || cat === "deportes" || cat === "anime" || cat === "noticias";
      })
      .map((c) => {
        const stitched = c.stitched || {};
        const urls = Array.isArray(stitched.urls) ? stitched.urls : [];
        const master = (urls[0] && urls[0].url) || "";
        let logo = c.logo || c.colorLogoPNG || c.solidLogoPNG || "";
        if (logo && typeof logo === "object") logo = logo.url || "";
        const thumb = c.thumbnail && typeof c.thumbnail === "object" ? c.thumbnail.url || "" : "";
        return {
          id: "pluto-" + (c.slug || c._id || "x"),
          name: String(c.name || c.slug || "Canal"),
          slug: c.slug,
          category: normalizeCategory(c.category),
          logo: String(logo || thumb || ""),
          stream: String(master), // master stitcher crudo (para M3U y proxy)
          web: true,
        };
      })
      .filter((c) => c.stream)
      .filter((c, i, arr) => arr.findIndex((x) => x.slug === c.slug) === i); // dedupe por slug (el API repite algunos)
    plutoCache = { ts: now, data: channels, error: null };
    return channels;
  } catch (error) {
    plutoCache = { ts: now, data: plutoCache.data, error: error.message };
    return plutoCache.data || [];
  }
}

/* ================= Canales Chile (lista curada) ================= */
// web: true  = HTTPS + CORS verificado -> se muestra en la web app
// web: false = HTTP (mixed content) o sin CORS -> solo playlist M3U (tele/red chilena)

const CL_CHANNELS = [
  // --- Noticias (HTTPS verificado) ---
  { id: "cl-t13", name: "T13 En Vivo", category: "noticias", stream: "https://redirector.dps.live/hls/t13/playlist.m3u8", web: true },
  { id: "cl-cooperativa", name: "Cooperativa TV", category: "noticias", stream: "https://unlimited1-cl-isp.dps.live/coopetv/coopetv.smil/playlist.m3u8", web: true },
  { id: "cl-adn", name: "ADN TV", category: "noticias", stream: "https://redirector.rudo.video/hls-video/931b584451fa6dd1313ee66efbfd5802e3f3bcea/adntv/adntv.smil/playlist.m3u8", web: true },
  { id: "cl-telecanal-sc", name: "Telecanal (stream)", category: "noticias", stream: "https://origin-us.streaminghd.cl/telecanal/telecanal/playlist.m3u8", web: true },
  // --- Nacionales (HTTPS verificado) ---
  { id: "cl-tvmas", name: "TV+", category: "nacionales", stream: "https://jireh-8-hls-video-us-isp.dps.live/hls-video/ey6283je82983je9823je8jowowiekldk9838274/tvmas/tvmas.smil/playlist.m3u8", web: true },
  // --- Nacionales (HTTP / red chilena -> solo M3U) ---
  { id: "cl-tvn", name: "TVN", category: "nacionales", stream: "http://15.204.246.24:8080/TVNHD/index.m3u8", web: false },
  { id: "cl-mega", name: "Mega", category: "nacionales", stream: "http://15.204.246.24:8080/MEGAHD/index.m3u8", web: false },
  { id: "cl-chv", name: "Chilevisión", category: "nacionales", stream: "http://15.204.246.24:8080/CHVHD/index.m3u8", web: false },
  { id: "cl-13", name: "Canal 13", category: "nacionales", stream: "http://15.204.246.24:8080/Canal13HD/index.m3u8", web: false },
  { id: "cl-lared", name: "La Red", category: "nacionales", stream: "http://cdn1tlinkgo.tlink.cl/laredhd/mono.m3u8", web: false },
  { id: "cl-mega2", name: "Mega 2", category: "nacionales", stream: "http://15.204.246.24:8080/Mega2HD/index.m3u8", web: false },
  { id: "cl-zonalatina", name: "Zona Latina", category: "nacionales", stream: "http://45.162.193.35/ZONALATINA/index.m3u8", web: false },
  { id: "cl-tvn3", name: "TVN3", category: "nacionales", stream: "http://cdn1tlinkgo.tlink.cl/tvn3/mono.m3u8", web: false },
  { id: "cl-ucv", name: "UCV TV", category: "nacionales", stream: "http://cdn1tlinkgo.tlink.cl/ucvhd/mono.m3u8", web: false },
  { id: "cl-chilechannel", name: "Chile Channel", category: "nacionales", stream: "https://v2.tustreaming.cl/chilechannel/index.m3u8", web: false },
  { id: "cl-tvchile", name: "TV Chile", category: "nacionales", stream: "https://mdstrm.com/live-stream-playlist/533adcc949386ce765657d7c.m3u8", web: false },
  { id: "cl-pauta", name: "Pauta", category: "nacionales", stream: "https://redirector.rudo.video/hls-video/ey6283je82983je9823je8jowowiekldk9838274/pautatv/pautatv.smil/playlist.m3u8", web: false },
  { id: "cl-surtv", name: "SUR TV", category: "nacionales", stream: "https://redirector.rudo.video/hls-video/ey6283je82983je9823je8jowowiekldk9838274/surtv/surtv.smil/playlist.m3u8", web: false },
  // --- Noticias (HTTP -> solo M3U) ---
  { id: "cl-24h", name: "24 Horas", category: "noticias", stream: "http://cdn1tlinkgo.tlink.cl/24horashd/mono.m3u8", web: false },
  { id: "cl-meganoticias", name: "Meganoticias Ahora", category: "noticias", stream: "http://cdn1tlinkgo.tlink.cl/meganoticias/mono.m3u8", web: false },
  { id: "cl-ntv", name: "NTV", category: "noticias", stream: "http://cdn1tlinkgo.tlink.cl/ntvhd/mono.m3u8", web: false },
  { id: "cl-biobio", name: "Bio Bío TV", category: "noticias", stream: "http://cdn1tlinkgo.tlink.cl/biobiotv/mono.m3u8", web: false },
  { id: "cl-senado", name: "TV Senado", category: "noticias", stream: "http://cdn1tlinkgo.tlink.cl/tvsenado/mono.m3u8", web: false },
  // --- Deportes ---
  { id: "cl-cdo", name: "CDO (Deporte Olímpico)", category: "deportes", stream: "http://cdn1tlinkgo.tlink.cl/cdo/mono.m3u8", web: false },
  { id: "cl-teletrak", name: "Teletrak TV", category: "deportes", stream: "http://cdn1tlinkgo.tlink.cl/teletrak/index.m3u8", web: false },
];

/* ================= Proxy de manifests ================= */
// Solo proxeamos los manifests (respuestas de KB): los segmentos y claves
// AES van directo del navegador (los CDN verificados traen ACAO: *).

async function proxyManifest(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
    validateStatus: () => true,
    headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
  });
  return {
    status: res.status,
    contentType: res.headers["content-type"] || "application/vnd.apple.mpegurl; charset=utf-8",
    body: Buffer.from(res.data),
  };
}

// Reescribe las variants RELATIVAS del master a URLs absolutas del proxy.
function rewriteMaster(text, prefix, masterUrl) {
  const clean = String(masterUrl).split("?")[0];
  const slash = clean.lastIndexOf("/");
  const base = slash > 0 ? clean.substring(0, slash) : clean;
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return line;
      if (/^https?:\/\//i.test(t)) return line; // ya es absoluta (se mantiene)
      return prefix + encodeURIComponent(base + "/" + t);
    })
    .join("\n");
}

/* ================= Playlist M3U ================= */

const GROUP_LABELS = { deportes: "Deportes", anime: "Animé & Gaming", noticias: "Noticias", nacionales: "Chile", otras: "Otros" };

function buildPlaylist(plutoChannels) {
  const all = [...(plutoChannels || []), ...CL_CHANNELS];
  const lines = ["#EXTM3U"];
  for (const c of all) {
    const group = GROUP_LABELS[c.category] || "Otros";
    const logo = c.logo ? ` tvg-logo="${c.logo}"` : "";
    const name = String(c.name).replace(/,/g, " ").trim();
    lines.push(`#EXTINF:-1 tvg-id="${c.id}" group-title="${group}"${logo},${name}`);
    lines.push(c.stream);
  }
  return lines.join("\n") + "\n";
}

module.exports = { fetchPlutoChannels, proxyManifest, rewriteMaster, buildPlaylist, CL_CHANNELS };