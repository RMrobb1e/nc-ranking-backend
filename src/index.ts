import { serve } from "@hono/node-server";
import { regions, weaponTypes, rankingTypes } from "./utils/constants";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { timeout } from "hono/timeout";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import dotenv from "dotenv";
dotenv.config();

type Env = {
  GIPHY_API_KEY: string;
};

interface CacheItem<T = any> {
  data: T;
  expires: number;
}

interface RankingData {
  pageProps?: {
    _nextI18Next?: unknown;
    rankingListData?: { items?: any[] };
    [key: string]: unknown;
  };
}

interface PlayerItem {
  RegionID: number;
  CharacterName: string;
  score?: number;
}

// Configuration
const config = {
  NC_API_KEY: "s66NUzeEK7j57fyppA1Lz",
  ALLOWED_ORIGINS: [
    "https://reru-nc-ranking.onrender.com",
    "https://rmrobb1e.github.io",
    "https://reru-nc-ranking.vercel.app",
    "https://nc-ranking-react.vercel.app",
    "http://localhost:3000",
    "http://localhost:5500",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ],
  REQUEST_TIMEOUT: 30000, // 30 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
};

const app = new Hono<{ Bindings: Env }>();

// Enhanced cache with TTL support
class TTLCache {
  private cache = new Map<string, CacheItem>();

  set(key: string, data: any, ttlSeconds: number): void {
    const expires = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { data, expires });

    // Auto-cleanup expired entries
    setTimeout(() => {
      this.delete(key);
    }, ttlSeconds * 1000);
  }

  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    // Clean expired entries first
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
      }
    }
    return this.cache.size;
  }
}

const cache = new TTLCache();

// Utility functions
function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

function sanitizeData(data: unknown): RankingData {
  const rankingData = data as RankingData;
  if (rankingData.pageProps && "_nextI18Next" in rankingData.pageProps) {
    delete rankingData.pageProps._nextI18Next;
  }
  return rankingData;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = config.MAX_RETRIES
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        config.REQUEST_TIMEOUT
      );

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Referer: "https://www.nightcrows.com/en/ranking/level",
          "User-Agent": "Mozilla/5.0 (compatible; NightCrows-API/1.0)",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.warn(`Fetch attempt ${i + 1} failed for ${url}:`, error);

      if (i === retries - 1) throw error;

      // Exponential backoff with jitter
      const delay = config.RETRY_DELAY * Math.pow(2, i) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Failed to fetch after ${retries} attempts`);
}

// Middleware
app.use("*", logger());
app.use("*", compress());
app.use("*", secureHeaders());
app.use("*", timeout(config.REQUEST_TIMEOUT));

app.use(
  "/api/*",
  cors({
    origin: origin => {
      if (!origin) return null;
      return config.ALLOWED_ORIGINS.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Health check endpoint
app.get("/api/health", c => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cacheSize: cache.size(),
    uptime: process.uptime(),
  });
});

// Giphy API key endpoint
app.get("/api/giphy-key", c => {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Giphy API key not configured" }, 500);
  }
  return c.json({ apiKey });
});

// Metadata endpoint
app.get("/api/metadata", c => {
  const data = {
    regions,
    weaponTypes,
    rankingTypes,
    lastUpdated: new Date().toISOString(),
  };
  return c.json(data);
});

// Player growth lookup endpoint
app.get("/api/growth", async c => {
  const ign = c.req.query("ign")?.trim();
  const regionCode = c.req.query("regionCode") || "0";

  if (!ign) {
    return c.json({ error: "Missing or empty ign parameter" }, 400);
  }

  const cacheKey = `growth-${ign}-${regionCode}`.toLowerCase();
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return c.json(cachedData);
  }

  const url = `https://www.nightcrows.com/_next/data/${config.NC_API_KEY}/en/ranking/growth.json?regionCode=${regionCode}&weaponType=0&wmsso_sign=check&keyword=${encodeURIComponent(ign)}&rankingType=growth`;

  try {
    const response = await fetchWithRetry(url);
    const data: unknown = await response.json();
    const sanitizedData = sanitizeData(data);

    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, sanitizedData, ttl);

    return c.json(sanitizedData);
  } catch (error) {
    console.error("Error fetching growth data:", error);
    return c.json(
      {
        error: "Failed to fetch growth data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Growth page endpoint
app.get("/api/growth-page", async c => {
  const page = parseInt(c.req.query("page") || "1");
  const regionCode = c.req.query("regionCode") || "0";

  if (page < 1 || page > 100) {
    return c.json({ error: "Page must be between 1 and 100" }, 400);
  }

  const cacheKey = `growth-page-${page}-${regionCode}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return c.json(cachedData);
  }

  const url = `https://www.nightcrows.com/_next/data/${config.NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}`;

  try {
    const response = await fetchWithRetry(url);
    const data: unknown = await response.json();
    const sanitizedData = sanitizeData(data);

    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, sanitizedData, ttl);

    return c.json(sanitizedData);
  } catch (error) {
    console.error("Error fetching growth page:", error);
    return c.json(
      {
        error: "Failed to fetch growth page data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Top 1000 growth players endpoint
app.get("/api/growth-top-1000", async c => {
  const regionCode = c.req.query("regionCode") || "0";
  const cacheKey = `growth-top-1000-${regionCode}`;

  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return c.json(cachedData);
  }

  try {
    const allItems: any[] = [];
    const fetchPromises = Array.from({ length: 10 }, (_, i) => {
      const page = i + 1;
      const url = `https://www.nightcrows.com/_next/data/${config.NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}`;

      return fetchWithRetry(url)
        .then(response => response.json())
        .then((data: unknown) => {
          const sanitizedData = sanitizeData(data);
          return sanitizedData.pageProps?.rankingListData?.items || [];
        })
        .catch(error => {
          console.error(`Error fetching page ${page}:`, error);
          return [];
        });
    });

    const pagesItems = await Promise.all(fetchPromises);

    for (const items of pagesItems) {
      allItems.push(...items);
    }

    const result = {
      items: allItems.slice(0, 1000),
      totalFetched: allItems.length,
      regionCode,
      timestamp: new Date().toISOString(),
    };

    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, result, ttl);

    return c.json(result);
  } catch (error) {
    console.error("Error fetching top 1000 growth data:", error);
    return c.json(
      {
        error: "Failed to fetch top 1000 growth data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Top players across all regions/weapons endpoint
app.get("/api/growth-top-players", async c => {
  const regionCodeParam = c.req.query("regionCode");
  // const limit = parseInt(c.req.query("limit") || "1000");

  // if (limit < 1 || limit > 10000) {
  //   return c.json({ error: "Limit must be between 1 and 10000" }, 400);
  // }

  const cacheKey = regionCodeParam
    ? `growth-top-players-${regionCodeParam}`
    : `growth-top-players`;

  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return c.json(cachedData);
  }

  try {
    const allItems: PlayerItem[] = [];
    const regionPromises = [];

    for (const region of regions) {
      const regionCode = region.code;
      if (regionCode === 0) continue; // Skip 'ALL' region

      if (regionCodeParam && String(regionCode) !== String(regionCodeParam)) {
        continue;
      }

      for (const [weaponTypeName, weaponType] of Object.entries(weaponTypes)) {
        if (weaponTypeName === "All") continue; // Skip 'All' weapon type

        const weaponPromise = Promise.all(
          Array.from({ length: 10 }, (_, i) => {
            const page = i + 1;
            const url = `https://www.nightcrows.com/_next/data/${config.NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${page}&weaponType=${weaponType}`;

            return fetchWithRetry(url)
              .then(response => response.json())
              .then((data: unknown) => {
                const sanitizedData = sanitizeData(data);
                return sanitizedData.pageProps?.rankingListData?.items || [];
              })
              .catch(error => {
                console.error(
                  `Error fetching region ${regionCode}, weapon ${weaponType}, page ${page}:`,
                  error
                );
                return [];
              });
          })
        ).then(pagesItems => {
          const items: PlayerItem[] = [];
          for (const pageItems of pagesItems) {
            items.push(...pageItems);
          }
          return items;
        });

        regionPromises.push(weaponPromise);
      }
    }

    const regionResults = await Promise.all(regionPromises);

    for (const items of regionResults) {
      allItems.push(...items);
    }

    // Remove duplicates based on RegionID and CharacterName
    const uniqueItems = Array.from(
      new Map(
        allItems
          .filter(item => item.CharacterName && item.RegionID)
          .map(item => [`${item.RegionID}-${item.CharacterName}`, item])
      ).values()
    );

    // Sort by score descending
    uniqueItems.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Normalize ranking - assign rank based on position after sorting
    const rankedItems = uniqueItems.map((item, index) => ({
      ...item,
      rank: index + 1, // Assign rank starting from 1
    }));

    const result = {
      items: rankedItems,
      totalUnique: uniqueItems.length,
      totalFetched: allItems.length,
      regionCode: regionCodeParam || "all",
      timestamp: new Date().toISOString(),
    };

    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, result, ttl);

    return c.json(result);
  } catch (error) {
    console.error("Error fetching top players:", error);
    return c.json(
      {
        error: "Failed to fetch top players data",
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

// Cache management endpoints
app.get("/api/cache/stats", c => {
  return c.json({
    size: cache.size(),
    timestamp: new Date().toISOString(),
  });
});

app.delete("/api/cache/clear", c => {
  cache.clear();
  return c.json({
    message: "Cache cleared successfully",
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      details: err.message,
      timestamp: new Date().toISOString(),
    },
    500
  );
});

// 404 handler
app.notFound(c => {
  return c.json(
    {
      error: "Not found",
      path: c.req.path,
      timestamp: new Date().toISOString(),
    },
    404
  );
});

// Start server
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST || "localhost";

// AlwaysData specific configuration
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  // Production logging
  console.log("🌐 Running in production mode");
  console.log(`🚀 Server will start on port ${port}`);
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📊 Available endpoints:`);
  console.log(`   GET /api/health - Health check`);
  console.log(`   GET /api/metadata - Game metadata`);
  console.log(`   GET /api/growth - Player growth lookup`);
  console.log(`   GET /api/growth-page - Growth ranking page`);
  console.log(`   GET /api/growth-top-1000 - Top 1000 players`);
  console.log(`   GET /api/growth-top-players - Top players across regions`);
  console.log(`   GET /api/cache/stats - Cache statistics`);
  console.log(`   DELETE /api/cache/clear - Clear cache`);
});

export default app;
