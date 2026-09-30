import { reviewHtml, reviewScript } from "./social-review-ui.js";
import { readLimited } from "./social-ai-media.js";

const ROOT = "/api/social-review";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const reply = (value, status = 200) =>
  Response.json(value, { status, headers });
async function authorized(request, env) {
  const supplied = request.headers.get("X-Admin-Key");
  if (!env.ADMIN_API_KEY || !supplied || supplied.length > 4096) return false;
  const digest = (s) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([
    digest(supplied),
    digest(env.ADMIN_API_KEY),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function reviewRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + "/"))
    return null;
  if (
    request.method === "GET" &&
    [ROOT, ROOT + "/app.js"].includes(url.pathname)
  ) {
    const script = url.pathname.endsWith("/app.js");
    return new Response(script ? reviewScript : reviewHtml, {
      headers: {
        ...headers,
        "Content-Type": script
          ? "text/javascript; charset=utf-8"
          : "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src https://drive.google.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  }
  if (!(await authorized(request, env)))
    return reply({ error: "Reviewer sign-in required." }, 401);
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== url.origin
  )
    return reply({ error: "Same-origin requests required." }, 403);
  if (!env.DB) return reply({ error: "Review is unavailable." }, 503);
  try {
    if (request.method === "GET" && url.pathname === ROOT + "/items") {
      const limit = 20;
      const offset = Number(url.searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
        return reply({ error: "Invalid page." }, 400);
      const rows = await env.DB.prepare(
        `SELECT id,source_file_id,source_file_name,caption,ai_metadata_json,updated_at FROM social_content WHERE workflow_state='review' AND scheduled_at IS NULL ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
      )
        .bind(limit + 1, offset)
        .all();
      const items = await Promise.all(
        rows.results.slice(0, limit).map(async (row) => {
          let metadata = {};
          try {
            metadata = JSON.parse(row.ai_metadata_json);
          } catch {}
          const targets = await env.DB.prepare(
            "SELECT id,platform,platform_caption,publish_status,updated_at FROM social_content_targets WHERE content_id=? ORDER BY platform",
          )
            .bind(row.id)
            .all();
          return {
            id: row.id,
            imported_name: row.source_file_name,
            source_file_id: row.source_file_id,
            caption: row.caption,
            summary:
              typeof metadata.summary === "string" ? metadata.summary : "",
            review_notes: Array.isArray(metadata.review_notes)
              ? metadata.review_notes.filter((n) => typeof n === "string")
              : [],
            targets: targets.results,
          };
        }),
      );
      return reply({
        items,
        next_offset: rows.results.length > limit ? offset + limit : null,
        publishing_enabled: false,
      });
    }
    if (request.method !== "PATCH" || url.pathname !== ROOT + "/target")
      return reply({ error: "Not found." }, 404);
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "JSON required." }, 415);
    let body;
    try {
      body = JSON.parse(
        new TextDecoder().decode(await readLimited(request, 16000)),
      );
    } catch {
      return reply({ error: "Invalid or oversized request." }, 400);
    }
    if (
      !body ||
      Object.keys(body).some(
        (k) => !["id", "updated_at", "caption", "action"].includes(k),
      ) ||
      typeof body.id !== "string" ||
      body.id.length > 512 ||
      typeof body.updated_at !== "string" ||
      body.updated_at.length > 64 ||
      typeof body.caption !== "string" ||
      !body.caption.trim() ||
      !["save", "approve", "revoke"].includes(body.action)
    )
      return reply({ error: "Invalid review change." }, 400);
    const target = await env.DB.prepare(
      "SELECT platform,updated_at FROM social_content_targets WHERE id=?",
    )
      .bind(body.id)
      .first();
    const limits = {
      instagram: 2000,
      linkedin: 2500,
      "google-business-profile": 1400,
    };
    if (!target || !limits[target.platform])
      return reply({ error: "Target not found." }, 404);
    if (body.caption.length > limits[target.platform])
      return reply({ error: "Caption is too long." }, 400);
    const updated = new Date(
      Math.max(Date.now(), (Date.parse(target.updated_at) || 0) + 1),
    ).toISOString();
    const status = body.action === "approve" ? "approved" : "draft";
    // One atomic compare-and-swap. An edit always invalidates prior approval.
    const changed = await env.DB.prepare(
      `UPDATE social_content_targets SET platform_caption=?,publish_status=?,updated_at=?
      WHERE id=? AND updated_at=? AND publish_status IN ('draft','approved') AND platform_post_id='' AND published_at IS NULL
      AND EXISTS (SELECT 1 FROM social_content c WHERE c.id=content_id AND c.workflow_state='review' AND c.scheduled_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM social_content_targets sibling WHERE sibling.content_id=social_content_targets.content_id AND sibling.publish_status NOT IN ('draft','approved'))`,
    )
      .bind(body.caption.trim(), status, updated, body.id, body.updated_at)
      .run();
    if (changed.meta.changes !== 1)
      return reply(
        {
          error:
            "This draft changed or is no longer editable. Reload before reviewing.",
        },
        409,
      );
    return reply({
      publish_status: status,
      updated_at: updated,
      publishing_enabled: false,
    });
  } catch {
    return reply({ error: "Review is temporarily unavailable." }, 503);
  }
}
