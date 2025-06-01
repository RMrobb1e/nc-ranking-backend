import { Hono } from "hono";

type Env = {
  GIPHY_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

const cache = new Map<string, any>();

function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}

app.use("/api/*", async (c, next) => {
  c.header(
    "Access-Control-Allow-Origin",
    "https://reru-nc-ranking.onrender.com",
  );
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  await next();
});

// GET /api/giphy-key
app.get("/api/giphy-key", (c) => {
  return c.json({ apiKey: c.env.GIPHY_API_KEY });
});

// GET /api/metadata
app.get("/api/metadata", (c) => {
  const data = {
    regions: ["Region1", "Region2"], // Replace with your real constants
    weaponTypes: ["Sword", "Bow"], // Replace with your real constants
    rankingTypes: ["growth", "power"],
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

  const url = `https://www.nightcrows.com/_next/data/gS2eBBlYqbNdFFZodjSYl/en/ranking/growth.json?regionCode=${regionCode}&weaponType=0&wmsso_sign=check&keyword=${encodeURIComponent(
    ign,
  )}&rankingType=growth`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const ttl = getSecondsUntilMidnight();
    cache.set(cacheKey, data);
    setTimeout(() => cache.delete(cacheKey), ttl * 1000);
    return c.json(data);
  } catch (e) {
    return c.json({ error: "Failed to fetch data" }, 500);
  }
});

export default app;
