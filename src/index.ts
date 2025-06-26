import { regions, weaponTypes, rankingTypes } from "./utils/constants";
import { Hono } from "hono";

type Env = {
  GIPHY_API_KEY: string;
};

const NC_API_KEY = "RurW1g27YvYnU6QRxphBf";

const app = new Hono<{ Bindings: Env }>();

const cache = new Map<string, any>();

function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

app.use("/api/*", async (c, next) => {
  const allowedOrigins = [
    "https://reru-nc-ranking.onrender.com",
    "https://rmrobb1e.github.io",
    "https://reru-nc-ranking.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ];
  const origin = c.req.header("Origin");
  if (origin && allowedOrigins.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
  }

  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  await next();
});

// GET /api/giphy-key
app.get("/api/giphy-key", (c) => {
  return c.json({ apiKey: c.env.GIPHY_API_KEY });
});

// GET /api/health
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// GET /api/metadata
app.get("/api/metadata", (c) => {
  const data = {
    regions,
    weaponTypes,
    rankingTypes,
  };
  return c.json(data);
});

// GET /api/growth?ign=&regionCode=
app.get("/api/growth", async (c) => {
  const ign = c.req.query("ign");
  const regionCode = c.req.query("regionCode") || "0";
  if (!ign) return c.json({ error: "Missing ign" }, 400);

  const cacheKey = `${ign}-${regionCode}`.toLowerCase();
  if (cache.has(cacheKey)) {
    return c.json(cache.get(cacheKey));
  }

  const url = `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?regionCode=${regionCode}&weaponType=0&wmsso_sign=check&keyword=${encodeURIComponent(
    ign,
  )}&rankingType=growth`;

  try {
    const response = await fetch(url, {
      headers: {
        Referer: "https://www.nightcrows.com/en/ranking/level",
      },
    });
    const data = await response.json();
    // Remove _nextI18Next if it exists
    const d = data as {
      pageProps?: { _nextI18Next?: unknown; [key: string]: unknown };
    };

    if (d.pageProps && "_nextI18Next" in d.pageProps) {
      delete d.pageProps._nextI18Next;
    }

    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, data);
    setTimeout(() => cache.delete(cacheKey), ttl * 1000);
    return c.json(data);
  } catch (e) {
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

// GET /api/growth-page?page=&regionCode=
app.get("/api/growth-page", async (c) => {
  const page = c.req.query("page") ?? "1";
  const regionCode = c.req.query("regionCode") ?? "0";
  const url = `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}`;
  try {
    const response = await fetch(url, {
      headers: {
        Referer: "https://www.nightcrows.com/en/ranking/level",
      },
    });
    const data = await response.json();
    // Remove _nextI18Next if it exists
    const d = data as {
      pageProps?: {
        _nextI18Next?: unknown;
        [key: string]: unknown;
        rankingListData?: { items?: any[] };
      };
    };
    if (d.pageProps && "_nextI18Next" in d.pageProps) {
      delete d.pageProps._nextI18Next;
    }
    return c.json(data);
  } catch (e) {
    console.log(e);
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

// GET /api/growth-top-1000
app.get("/api/growth-top-1000", async (c) => {
  const regionCode = c.req.query("regionCode") ?? "0";
  const cacheKey = `growth-top-1000-${regionCode}`;
  if (cache.has(cacheKey)) {
    return c.json(cache.get(cacheKey));
  }
  const allItems: any[] = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const url = `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}`;
      const response = await fetch(url, {
        headers: {
          Referer: "https://www.nightcrows.com/en/ranking/level",
        },
      });
      const data = await response.json();
      // Remove _nextI18Next if it exists
      const d = data as {
        pageProps?: {
          _nextI18Next?: unknown;
          [key: string]: unknown;
          rankingListData?: { items?: any[] };
        };
      };
      if (d.pageProps && "_nextI18Next" in d.pageProps) {
        delete d.pageProps._nextI18Next;
      }
      if (d.pageProps?.rankingListData?.items) {
        allItems.push(...d.pageProps.rankingListData.items);
      }
    }
    // Return only the top 1000 items (if more than 1000 are fetched)
    const result = { items: allItems.slice(0, 1000) };
    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, result);
    setTimeout(() => cache.delete(cacheKey), ttl * 1000);
    return c.json(result);
  } catch (e) {
    console.log(e);
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});


app.get("/api/growth-top-players", async (c) => {
  // Import regions and weaponTypes from constants
  // (already imported at the top)
  const regionCodeParam = c.req.query("regionCode");
  const cacheKey = regionCodeParam ? `growth-top-players-${regionCodeParam}` : `growth-top-players`;
  if (cache.has(cacheKey)) {
    return c.json(cache.get(cacheKey));
  }
  const allItems: any[] = [];
  try {
    for (const region of regions) {
      const regionCode = region.code;
      if (regionCode === 0) continue; // skip 'ALL' region
      if (regionCodeParam && String(regionCode) !== String(regionCodeParam)) continue;
      for (const [weaponTypeName, weaponType] of Object.entries(weaponTypes)) {
        if (weaponTypeName === "All") continue; // skip 'All' weapon type
        // Fetch all 10 pages in parallel for this region/weaponType
        const fetches = Array.from({ length: 10 }, (_, i) => {
          const page = i + 1;
          const url = `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}&weaponType=${weaponType}`;
          return fetch(url, {
            headers: {
              Referer: "https://www.nightcrows.com/en/ranking/level",
            },
          })
            .then(async response => {
              if (!response.ok) {
                console.error(`Failed to fetch: ${url} (status: ${response.status})`);
                return [];
              }
              const data = await response.json();
              // Remove _nextI18Next if it exists
              const d = data as {
                pageProps?: {
                  _nextI18Next?: unknown;
                  [key: string]: unknown;
                  rankingListData?: { items?: any[] };
                };
              };
              if (d.pageProps && "_nextI18Next" in d.pageProps) {
                delete d.pageProps._nextI18Next;
              }
              return d.pageProps?.rankingListData?.items || [];
            })
            .catch(err => {
              console.error(`Error fetching: ${url}`, err);
              return [];
            });
        });
        const pagesItems = await Promise.all(fetches);
        for (const items of pagesItems) {
          allItems.push(...items);
        }
      }
    }
    // Normalize and remove duplicates based on RegionID and CharacterName
    const seen = new Set();
    const uniqueItems = [];
    for (const item of allItems) {
      const key = `${item.RegionID}-${item.CharacterName}`;
      if (item.CharacterName && item.RegionID && !seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }
    // Sort by score descending
    uniqueItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const result = { items: uniqueItems };
    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, result);
    setTimeout(() => cache.delete(cacheKey), ttl * 1000);
    return c.json(result);
  } catch (e) {
    console.log(e);
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});


export default app;
