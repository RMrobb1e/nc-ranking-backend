import { Hono } from "hono";
import { rankingTypes, regions, weaponTypes } from "./utils/constants";
import { scheduled as cronJob } from "./cron";

type Env = {
  GIPHY_API_KEY: string;
  ENV: string;
};
export const scheduled = cronJob;

const NC_API_KEY = "RurW1g27YvYnU6QRxphBf";

const app = new Hono<{ Bindings: Env }>();

const cache = new Map<string, any>();
// --- Batch warming logic for recursive fetches ---

const BATCH_SIZE = 3;
function getAllRegionWeaponCombos() {
  const combos = [];
  for (const region of regions) {
    const regionCode = region.code;
    if (regionCode === 0) continue;
    for (const [weaponTypeName, weaponType] of Object.entries(weaponTypes)) {
      if (weaponTypeName === "All") continue;
      combos.push({ regionCode, weaponType });
    }
  }
  return combos;
}

// Helper to get/set cache, using KV if available (Cloudflare Workers)
async function getCache(key: string, c: any) {
  if (typeof c.env !== "undefined" && c.env.KV) {
    const value = await c.env.KV.get(key, "json");
    return value;
  }
  return cache.get(key);
}

async function setCache(key: string, value: any, ttlSeconds: number, c: any) {
  if (typeof c.env !== "undefined" && c.env.KV) {
    await c.env.KV.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
    return;
  }
  cache.set(key, value);
  setTimeout(() => cache.delete(key), ttlSeconds * 1000);
}

// Helper to limit concurrent fetches
async function limitedParallelFetches(
  urls: string[],
  fetchOptions: RequestInit,
  limit = 3,
) {
  const results: any[] = [];
  let i = 0;
  async function next() {
    if (i >= urls.length) return;
    const idx = i++;
    try {
      const response = await fetch(urls[idx], fetchOptions);
      if (!response.ok) {
        console.error(
          `Failed to fetch: ${urls[idx]} (status: ${response.status})`,
        );
        results[idx] = [];
      } else {
        const data = await response.json();
        const d = data as {
          pageProps?: {
            _nextI18Next?: unknown;
            [key: string]: unknown;
            rankingListData?: { items?: any[] };
          };
        };
        if (d.pageProps && "_nextI18Next" in d.pageProps)
          delete d.pageProps._nextI18Next;
        results[idx] = d.pageProps?.rankingListData?.items || [];
      }
    } catch (err) {
      console.error(`Error fetching: ${urls[idx]}`, err);
      results[idx] = [];
    }
    await next();
  }
  await Promise.all(Array.from({ length: limit }, next));
  return results;
}
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

// GET /api/growth-warm-batch?batch=N (must be after app declaration)
app.get("/api/growth-warm-batch", async (c) => {
  // Add a short delay before reading/writing to KV to help with Cloudflare KV propagation
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(250); // 250ms delay for debugging
  const batchParam = c.req.query("batch") || "1";
  const batch = parseInt(batchParam, 10);
  if (isNaN(batch) || batch < 1) {
    console.log(`[warm-batch] Invalid batch param: ${batchParam}`);
    return c.json({ error: "Invalid batch" }, 400);
  }
  const combos = getAllRegionWeaponCombos();
  const totalBatches = Math.ceil(combos.length / BATCH_SIZE);
  const start = (batch - 1) * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, combos.length);
  const batchCombos = combos.slice(start, end);
  console.log(
    `[warm-batch] Starting batch ${batch}/${totalBatches} [combos ${start} to ${
      end - 1
    }] at ${new Date().toISOString()}`,
  );
  console.log(
    `[warm-batch] combos.length: ${combos.length}, start: ${start}, end: ${end}, batchCombos.length: ${batchCombos.length}`,
  );
  if (batchCombos.length === 0) {
    console.warn(`[warm-batch] Batch ${batch} has no combos to process!`);
  }
  const allItems = [];
  for (const { regionCode, weaponType } of batchCombos) {
    console.log(
      `[warm-batch] Fetching regionCode=${regionCode}, weaponType=${weaponType}`,
    );
    const urls = Array.from(
      { length: 10 },
      (_, i) =>
        `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${
          i + 1
        }&weaponType=${weaponType}`,
    );
    const pagesItems = await limitedParallelFetches(
      urls,
      {
        headers: { Referer: "https://www.nightcrows.com/en/ranking/level" },
      },
      3,
    );
    for (const items of pagesItems) {
      allItems.push(...items);
    }
  }
  // Save this batch's items to Cloudflare KV
  const batchCacheKey = `growth-warm-batch-${batch}`;
  const ttl = getSecondsUntilMidnight();
  await sleep(250); // 250ms delay before writing to KV for debugging
  await setCache(batchCacheKey, { items: allItems }, ttl, c);
  // Only cache on the last batch
  let status = `Batch ${batch} of ${totalBatches} complete.`;
  if (batch < totalBatches) {
    // Call next batch recursively using absolute URL (Cloudflare Workers requires this)
    let nextBatchUrl;
    if (c.env.ENV === "production") {
      nextBatchUrl = `https://nc-ranking-backend.robbie-ad5.workers.dev/api/growth-top-players-warm-batch?batch=${
        batch + 1
      }`;
    } else {
      nextBatchUrl = `http://localhost:8787/api/growth-top-players-warm-batch?batch=${
        batch + 1
      }`;
    }

    console.log(
      `[warm-batch] Batch ${batch} done, triggering batch ${
        batch + 1
      } url: ${nextBatchUrl}`,
    );
    await fetch(nextBatchUrl, { method: "GET" });
    status += ` Triggered batch ${batch + 1}.`;
  } else {
    // On last batch, normalize, dedupe, sort, and cache
    console.log(`[warm-batch] Last batch, deduping and caching results...`);
    const seen = new Set();
    const uniqueItems = [];
    for (const item of allItems) {
      const normalizedName =
        typeof item.CharacterName === "string"
          ? item.CharacterName.normalize("NFC")
          : item.CharacterName;
      const key = `${item.RegionID}-${normalizedName}`;
      if (normalizedName && item.RegionID && !seen.has(key)) {
        seen.add(key);
        uniqueItems.push({ ...item, CharacterName: normalizedName });
      }
    }
    uniqueItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const result = { items: uniqueItems };
    const ttl = getSecondsUntilMidnight();
    await setCache("growth-top-players-ALL", result, ttl, c);
    status += ` All batches done. Cached ${uniqueItems.length} items.`;
    console.log(
      `[warm-batch] All batches done. Cached ${uniqueItems.length} items.`,
    );
  }
  return c.json({ status });
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
    console.log({
      error: "Failed to fetch data",
      details: e instanceof Error ? e.message : String(e),
      e,
    });
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

// Serve only cached data for all top players (must be after getCache is defined)
app.get("/api/growth-top-players", async (c) => {
  // Aggregate all batch results from KV
  const combos = getAllRegionWeaponCombos();
  const totalBatches = Math.ceil(combos.length / BATCH_SIZE);
  let allItems = [];
  for (let batch = 1; batch <= totalBatches; batch++) {
    const batchCacheKey = `growth-warm-batch-${batch}`;
    const batchData = await getCache(batchCacheKey, c);
    if (batchData && Array.isArray(batchData.items)) {
      allItems.push(...batchData.items);
    }
  }
  if (allItems.length === 0) {
    return c.json(
      {
        error:
          "Cache not warmed. Please POST to /api/growth-top-players-warm first.",
      },
      503,
    );
  }
  // Deduplicate and sort
  const seen = new Set();
  const uniqueItems = [];
  for (const item of allItems) {
    const normalizedName =
      typeof item.CharacterName === "string"
        ? item.CharacterName.normalize("NFC")
        : item.CharacterName;
    const key = `${item.RegionID}-${normalizedName}`;
    if (normalizedName && item.RegionID && !seen.has(key)) {
      seen.add(key);
      uniqueItems.push({ ...item, CharacterName: normalizedName });
    }
  }
  uniqueItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return c.json({ items: uniqueItems });
});

// WARM-UP ENDPOINT: Triggers batch warming (starts at batch 1)
app.post("/api/growth-top-players-warm", async (c) => {
  try {
    let url;
    const origin = c.req.header("origin") || c.req.header("Origin") || "";
    if (c.env.ENV === "production") {
      url = `https://nc-ranking-backend.robbie-ad5.workers.dev/api/growth-top-players-warm-batch?batch=1`;
    } else {
      url = `http://localhost:8787/api/growth-top-players-warm-batch?batch=1`;
    }
    console.log(
      `[warm] Triggering batch warming at ${url} from origin ${origin}`,
    );
    c.executionCtx.waitUntil(fetch(url, { method: "GET" }));
    return c.json({ status: "Batch warming started." });
  } catch (e) {
    console.error("Error in /api/growth-top-players-warm:", e);
    return c.json({ error: "Failed to start batch warming." }, 500);
  }
});

// Serve only cached data for all top players (must be after getCache is defined)
app.get("/api/growth-top-players", async (c) => {
  const cacheKey = "growth-top-players-ALL";
  const cached = await getCache(cacheKey, c);
  if (cached) {
    return c.json(cached);
  }
  return c.json(
    {
      error:
        "Cache not warmed. Please POST to /api/growth-top-players-warm first.",
    },
    503,
  );
});

// POST /api/growth-top-players-warm-batch?batch=N
app.get("/api/growth-top-players-warm-batch", async (c) => {
  const batch = parseInt(c.req.query("batch") ?? "1", 10); // 1-based
  const requestId = Date.now() + "-" + Math.floor(Math.random() * 10000);
  console.log(`[warm-batch-alt] START batch ${batch} requestId=${requestId}`);
  const weaponTypeEntries = Object.entries(weaponTypes).filter(
    ([name]) => name !== "All",
  );
  const regionCodes = regions.map((r) => r.code).filter((code) => code !== 0);
  const combos = [];
  for (const [_, weaponType] of weaponTypeEntries) {
    for (const regionCode of regionCodes) {
      combos.push({ regionCode, weaponType });
    }
  }
  const combosPerBatch = 1; // each combo = 10 pages = 10 requests
  const totalBatches = Math.ceil(combos.length / combosPerBatch);
  const start = (batch - 1) * combosPerBatch;
  const end = Math.min(start + combosPerBatch, combos.length);
  const current = combos.slice(start, end);
  console.log(
    `[warm-batch-alt] combos.length: ${combos.length}, batch: ${batch}, totalBatches: ${totalBatches}, start: ${start}, end: ${end}, current.length: ${current.length}`,
  );
  let totalFetched = 0;
  let allItems = [];
  for (const { regionCode, weaponType } of current) {
    const urls = Array.from(
      { length: 10 },
      (_, i) =>
        `https://www.nightcrows.com/_next/data/${NC_API_KEY}/en/ranking/growth.json?rankingType=growth&regionCode=${regionCode}&page=${
          i + 1
        }&weaponType=${weaponType}`,
    );
    console.log(
      `[warm-batch-alt] [${requestId}] Batch ${batch} regionCode=${regionCode} weaponType=${weaponType} URLs:`,
      urls,
    );
    console.log(
      `[warm-batch-alt] [${requestId}] Fetching ${urls.length} URLs with concurrency 3`,
    );
    const pagesItems = await limitedParallelFetches(
      urls,
      {
        headers: { Referer: "https://www.nightcrows.com/en/ranking/level" },
      },
      3,
    );
    console.log(
      `[warm-batch-alt] [${requestId}] Finished fetching URLs for regionCode=${regionCode} weaponType=${weaponType}`,
    );
    totalFetched += pagesItems.flat().length;
    allItems.push(...pagesItems.flat());
  }
  console.log(
    `[warm-batch-alt] [${requestId}] Batch ${batch} fetched total ${totalFetched} items.`,
  );
  // Save this batch's items to Cloudflare KV
  const batchCacheKey = `growth-warm-batch-alt-${batch}`;
  const ttl = getSecondsUntilMidnight();
  await setCache(batchCacheKey, { items: allItems }, ttl, c);
  // Optionally trigger next batch
  let status = `Batch ${batch} of ${totalBatches} complete. Fetched ${totalFetched} items.`;
  if (batch < totalBatches) {
    // Use request header 'origin' to determine prod/dev
    let nextBatchUrl;
    if (c.env.ENV === "production") {
      nextBatchUrl = `https://nc-ranking-backend.robbie-ad5.workers.dev/api/growth-top-players-warm-batch?batch=${
        batch + 1
      }`;
    } else {
      nextBatchUrl = `http://localhost:8787/api/growth-top-players-warm-batch?batch=${
        batch + 1
      }`;
    }
    await fetch(nextBatchUrl, { method: "GET" });
    status += ` Triggered batch ${batch + 1}.`;
  }
  return c.json({ status, batch, totalFetched });
});

export default app;
