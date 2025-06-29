// Cloudflare Workers scheduled() handler for cron triggers
export default async function scheduled(
  event: ScheduledEvent,
  env: any,
  ctx: any,
) {
  console.log("[scheduled] Warm-up started at", new Date().toISOString());
  // Trigger the batch warm-up endpoint as a scheduled job
  try {
    // Hardcode the batch URL for prod/dev
    let url;
    if (env.ENV === "production") {
      url =
        "https://nc-ranking-backend.robbie-ad5.workers.dev/api/growth-warm-batch?batch=1";
    } else {
      url = "http://localhost:8787/api/growth-warm-batch?batch=1";
    }
    await fetch(url, { method: "GET" });
    console.log(`[scheduled] Triggered batch warm-up at ${url}`);
  } catch (e) {
    console.error("[scheduled] Failed to trigger batch warm-up", e);
  }
}
