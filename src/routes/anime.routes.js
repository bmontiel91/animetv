const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const animeService = require("../services/anime.service");
const downloadService = require("../services/download.service");
const { ApiError } = require("../utils/api-error");

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

router.use(requireApiKey, dailyRateLimit);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const response = await animeService.searchAnime(req.query.q, req.query.domain);
    res.status(200).json(response);
  })
);

router.get(
  "/info",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const response = await animeService.getAnimeInfo(req.query.url);
    res.status(200).json(response);
  })
);

router.get(
  "/episode",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const response = await animeService.getEpisodeLinks(req.query.url, req.query.includeMega, req.query.excludeServers);
    res.status(200).json(response);
  })
);

router.get(
  "/player-proxy",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }
    const html = await animeService.proxyPlayerPage(req.query.url);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.status(200).send(html);
  })
);

router.get(
  "/player-proxy/:hash",
  asyncHandler(async (req, res) => {
    const hash = String(req.params.hash || "");
    if (!/^[a-f0-9]{32}$/i.test(hash)) {
      throw new ApiError(400, "Hash de player invalido");
    }
    const html = await animeService.proxyPlayerPage("https://player.zilla-networks.com/play/" + hash);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "public, max-age=600");
    res.status(200).send(html);
  })
);

router.get(
  "/hls-proxy",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }
    const up = await animeService.proxyHlsStream(req.query.url, req.headers.range || null);
    if (up.status >= 200 && up.status < 300) {
      res.status(up.status);
    } else {
      res.status(502).json({ success: false, message: "Origen rechazo la peticion", upstream: up.status });
      return;
    }
    if (up.contentType) res.set("Content-Type", up.contentType);
    if (up.contentRange) res.set("Content-Range", up.contentRange);
    if (up.acceptRanges) res.set("Accept-Ranges", up.acceptRanges);
    if (up.isManifest) {
      // Reescribir URLs de segmentos/manifests → este proxy (same-origin, sin CORS)
      const proto = req.headers["x-forwarded-proto"] || req.protocol;
      const selfBase = `${proto}://${req.get("host")}`;
      const proxyPrefix = selfBase + "/api/v1/anime/hls-proxy?url=";
      let text = up.body.toString("utf-8");
      text = text.replace(
        /https:\/\/player\.zilla-networks\.com\/(segs|m3u8)\//g,
        (match, kind) => proxyPrefix + encodeURIComponent(`https://player.zilla-networks.com/${kind}/`)
      );
      res.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.send(text);
    } else {
      res.set("Cache-Control", "public, max-age=300");
      res.send(up.body);
    }
  })
);

router.post(
  "/download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createDownload(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/download/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getDownload(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.post(
  "/batch-download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createBatch(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/batch/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getBatch(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

module.exports = router;
