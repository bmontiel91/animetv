const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");
const animeav1Service = require("./animeav1.service");
const jkanimeService = require("./jkanime.service");
const animeflvService = require("./animeflv.service");
const hentailaService = require("./hentaila.service");
const tioanimeService = require("./tioanime.service");
const monoschinosService = require("./monoschinos.service");

const DEFAULT_ANIME_DOMAIN = process.env.DEFAULT_ANIME_DOMAIN || "animeav1.com";

const PROVIDERS = [
  {
    id: "animeav1",
    label: "AnimeAV1",
    domains: [DEFAULT_ANIME_DOMAIN, "animeav1.com", "www.animeav1.com"],
    service: animeav1Service,
  },
  {
    id: "jkanime",
    label: "JKAnime",
    domains: ["jkanime.net", "www.jkanime.net"],
    service: jkanimeService,
  },
  {
    id: "animeflv",
    label: "AnimeFLV",
    domains: ["animeflv.net", "www.animeflv.net", "www4.animeflv.net"],
    service: animeflvService,
  },
  {
    id: "hentaila",
    label: "HentaiLA",
    domains: ["hentaila.com", "www.hentaila.com"],
    service: hentailaService,
  },
  {
    id: "tioanime",
    label: "TioAnime",
    domains: ["tioanime.com", "www.tioanime.com"],
    service: tioanimeService,
  },
  {
    id: "monoschinos",
    label: "MonosChinos",
    domains: ["monoschinos2.com", "www.monoschinos2.com"],
    service: monoschinosService,
  },
];

function normalizeDomain(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.toLowerCase();
    }
    return new URL(`https://${trimmed}`).hostname.toLowerCase();
  } catch (_error) {
    return trimmed.split("/")[0];
  }
}

function domainMatches(domain, candidate) {
  if (!domain || !candidate) {
    return false;
  }

  if (domain === candidate) {
    return true;
  }

  return domain.endsWith(`.${candidate}`);
}

function findProviderByDomain(domainCandidate) {
  const domain = normalizeDomain(domainCandidate);
  if (!domain) {
    return null;
  }

  return (
    PROVIDERS.find((provider) => provider.domains.some((candidate) => domainMatches(domain, candidate))) || null
  );
}

function findProviderById(providerId) {
  if (!providerId || typeof providerId !== "string") {
    return null;
  }

  const normalized = providerId.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.id === normalized) || null;
}

function findProviderForUrl(urlCandidate) {
  if (!urlCandidate || typeof urlCandidate !== "string") {
    return null;
  }

  try {
    const host = new URL(urlCandidate).hostname;
    return findProviderByDomain(host);
  } catch (_error) {
    return null;
  }
}

async function searchAnime(query, domainCandidate) {
  const forcedProvider = findProviderByDomain(domainCandidate) || findProviderById(domainCandidate);
  const providersToTry = forcedProvider ? [forcedProvider] : PROVIDERS;

  let lastEmpty = null;
  const errors = [];

  for (const provider of providersToTry) {
    try {
      const result = await provider.service.searchAnime(query, provider.domains[0]);
      const count = result?.data?.count ?? 0;
      if (count > 0 || forcedProvider) {
        return {
          ...result,
          source: result?.source || provider.id,
        };
      }

      if (!lastEmpty) {
        lastEmpty = {
          ...result,
          source: result?.source || provider.id,
        };
      }
    } catch (error) {
      errors.push({ provider: provider.id, error });
    }
  }

  if (lastEmpty) {
    return lastEmpty;
  }

  if (errors.length === providersToTry.length && errors[0]?.error) {
    throw errors[0].error;
  }

  throw new ApiError(502, "No se pudo completar la busqueda en proveedores");
}

async function getAnimeInfo(urlCandidate) {
  const provider = findProviderForUrl(urlCandidate) || PROVIDERS[0];
  if (!provider) {
    throw new ApiError(400, "Proveedor no soportado");
  }

  const result = await provider.service.getAnimeInfo(urlCandidate);
  return {
    ...result,
    source: result?.source || provider.id,
  };
}

async function getEpisodeLinks(urlCandidate, includeMega, excludeServers, moreProviders) {
  const provider = findProviderForUrl(urlCandidate) || PROVIDERS[0];
  if (!provider) {
    throw new ApiError(400, "Proveedor no soportado");
  }

  const result = await provider.service.getEpisodeLinks(urlCandidate, includeMega, excludeServers);
  const response = {
    ...result,
    source: result?.source || provider.id,
  };

  // "Más servidores": buscar el mismo episodio en los otros proveedores (TioAnime, JKAnime, AnimeFLV)
  if (moreProviders && response?.data?.servers && response?.data?.title) {
    const title = response.data.title;
    const epNum = response.data.episode;
    for (const other of PROVIDERS) {
      if (other.id === provider.id) continue;
      try {
        const search = await searchAnime(title, other.domains[0]);
        const candidates = search?.data?.results || [];
        if (!candidates.length) continue;
        const info = await getAnimeInfo(candidates[0].url);
        const episodes = info?.data?.episodes || [];
        const target = episodes.find((e) => String(e.number || '').trim() === String(epNum || '').trim() ||
          (String(e.title || '').toLowerCase().replace(/episodio|episode|cap[ií]tulo/g, '').trim() === String(epNum || '').trim())) ||
          (episodes.length === 1 ? episodes[0] : null);
        if (!target?.url) continue;
        const extra = await getEpisodeLinks(target.url, false, excludeServers, false);
        const extraServers = extra?.data?.servers || {};
        for (const variant of ["sub", "dub"]) {
          const list = extraServers[variant] || [];
          if (!response.data.servers[variant]) response.data.servers[variant] = [];
          for (const serv of list) {
            if (!response.data.servers[variant].some((x) => x.url === serv.url)) {
              response.data.servers[variant].push({ ...serv, extra: other.id });
            }
          }
        }
      } catch (_error) {
        // un proveedor caído no rompe el resto
      }
    }
  }

  return response;
}

async function proxyPlayerPage(urlCandidate) {
  return animeav1Service.proxyPlayerPage(urlCandidate);
}

async function proxyHlsStream(urlCandidate, rangeHeader) {
  return animeav1Service.proxyHlsStream(urlCandidate, rangeHeader);
}

async function resolveDirectVideo(urlCandidate) {
  return animeav1Service.resolveDirectVideo(urlCandidate);
}

async function proxyVideoStream(urlCandidate, rangeHeader) {
  return animeav1Service.proxyVideoStream(urlCandidate, rangeHeader);
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
  proxyPlayerPage,
  proxyHlsStream,
  resolveDirectVideo,
  proxyVideoStream,
};
