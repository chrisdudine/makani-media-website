const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {"Content-Type": "application/json; charset=utf-8", ...headers}
});

const text = value => typeof value === "string" ? value.trim() : "";
const list = value => Array.isArray(value) ? value.filter(v => typeof v === "string").map(v => v.trim()).filter(Boolean) : [];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type"} });
    }

    if (request.method !== "POST" || url.pathname !== "/api/consultation") {
      return json({ error: "Not found" }, 404);
    }

    if (!env.DB) return json({ error: "Database binding is not configured." }, 500);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON request." }, 400); }

    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const description = text(body.description);

    if (!name || !email || !description) return json({ error: "Name, email, and project description are required." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    if (name.length > 160 || email.length > 320 || description.length > 5000) return json({ error: "One or more fields are too long." }, 400);

    const contactId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      const contact = await env.DB.prepare(`
        INSERT INTO contacts (id, name, business, email, phone, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          name = excluded.name,
          business = CASE WHEN excluded.business <> '' THEN excluded.business ELSE contacts.business END,
          phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE contacts.phone END,
          updated_at = excluded.updated_at
        RETURNING id
      `).bind(
        contactId, name, text(body.business), email, text(body.phone), text(body.source) || "website-consultation", now, now
      ).first();

      const finalContactId = contact?.id || contactId;
      const services = list(body.services);
      const addons = list(body.addons);

      await env.DB.prepare(`
        INSERT INTO projects (
          id, contact_id, project_type, location, preferred_date, frequency,
          services_json, addons_json, budget, description, questions, status,
          raw_submission_json, ai_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, 'pending', ?, ?)
      `).bind(
        projectId, finalContactId, text(body.projectType), text(body.location), text(body.preferredDate), text(body.frequency),
        JSON.stringify(services), JSON.stringify(addons), text(body.budget), description, text(body.questions),
        JSON.stringify(body), now, now
      ).run();

      return json({ success: true, projectId }, 201);
    } catch (error) {
      console.error("Consultation submission failed", error);
      return json({ error: "We could not save your request. Please try again." }, 500);
    }
  }
};
