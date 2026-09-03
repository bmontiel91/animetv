const express = require("express");
const { ApiError } = require("../utils/api-error");
const tvService = require("../services/tv.service");

const router = express.Router();

function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function selfPrefix(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

// Lista de canales para la web app (HTTPS + CORS ok; Pluto proxied en manifests)
router.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const pluto = await tvService.fetchPlutoChannels();
    const prefix = selfPrefix(req) + "/api/v1/tv/live-proxy?url=";
    const webChannels = [
      ...pluto.map((c) => ({ ...c, stream: prefix + encodeURIComponent(c.stream) })),
      ...tvService.CL_CHANNELS.filter((c) => c.web),
    ];
    res.status(200).json({ success: true, data: webChannels });
  })
);

// Proxy SOLO de manifests (master/variant). Segmentos y claves van directos.
router.get(
  "/live-proxy",
  asyncHandler(async (req, res) => {
    const url = String(req.query.url || "");
    if (!url) throw new ApiError(400, "Se requiere el parametro url");
    const up = await tvService.proxyManifest(url);
    if (!up || up.status < 200 || up.status >= 300) {
      res.status(502).json({ success: false, message: "El origen rechazo la peticion", upstream: up && up.status });
      return;
    }
    const prefix = selfPrefix(req) + "/api/v1/tv/live-proxy?url=";
    const text = tvService.rewriteMaster(up.body.toString("utf8"), prefix, url);
    res.set("Content-Type", up.contentType || "application/vnd.apple.mpegurl; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "no-store");
    res.status(200).send(text);
  })
);

// Playlist M3U completa (Pluto + Chile) para apps IPTV en la tele (TiviMate, OTT Navigator, VLC...)
router.get(
  "/playlist.m3u",
  asyncHandler(async (_req, res) => {
    const pluto = await tvService.fetchPlutoChannels();
    const playlist = tvService.buildPlaylist(pluto);
    res.set("Content-Type", "audio/x-mpegurl; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=300");
    res.status(200).send(playlist);
  })
);

module.exports = router;