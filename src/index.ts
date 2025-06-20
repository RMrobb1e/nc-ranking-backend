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
    const response = await fetch(url);
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

// GET /api/growth-top-100
app.get("/api/growth-top-100", async (c) => {
  const regionCode = c.req.query("regionCode") ?? "0";
  const url = `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}`;
  try {
    const response = await fetch(url);
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
    // Filter by regionCode if provided
    if (regionCode && d.pageProps?.rankingListData?.items) {
      d.pageProps.rankingListData.items =
        d.pageProps.rankingListData.items.filter(
          (item: any) => String(item.RegionID) === String(regionCode),
        );
    }
    return c.json(data);
  } catch (e) {
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

export default app;
