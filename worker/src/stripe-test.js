import legacy from "./booking-wrapper.js";
import { checkout, sdk, reply, recipient } from "./stripe-checkout.js";
import {
  webhook,
  verifyCalendar,
  retryPendingPayments,
} from "./stripe-fulfillment.js";
import { accessHash, accessExpires } from "./test-access.js";
export async function tokenValid(token) {
  if (Date.now() > accessExpires) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const expected = Uint8Array.from(accessHash.match(/../g), (v) =>
    parseInt(v, 16),
  );
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ expected[i];
  return difference === 0;
}
export async function authorized(request) {
  const cookie = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)mm_stripe_test=([^;]+)/)?.[1];
  return tokenValid(request.headers.get("X-Test-Token") || cookie || "");
}
const head = `<!doctype html><html><meta name="viewport" content="width=device-width"><title>Makani Media — Stripe Test Booking</title><style>body{font:18px system-ui;max-width:650px;margin:40px auto;padding:20px}label{display:block;margin:16px 0}input,select,textarea,button{font:inherit;padding:10px;box-sizing:border-box;width:100%}button{background:#075e62;color:white;border:0}small{display:block}</style><h1>Makani Media test booking</h1>`;
const login =
  head +
  '<p>Private sandbox. Enter the temporary test access code.</p><form method="post" action="/api/stripe/test-login"><label>Access code<input type="password" name="token" required></label><button>Open test booking</button></form></html>';
const page =
  head +
  `<p>Stripe Test Mode only. No real charge or appointment. Consultation total: $103.66. Shoot totals use existing package prices and duration.</p><form id="booking"><label>Booking type<select name="kind"><option value="consultation">Consultation — $103.66</option><option value="shoot">Book a Shoot</option></select></label><label>Name<input name="name" value="Sandbox Test" required></label><label>Test email<input name="email" value="${recipient}" readonly></label><label>Date<input name="preferredDate" type="date" min="2026-12-16" required></label><label>Start time<select name="preferredTime">${Array.from({ length: 9 }, (_, i) => "<option>" + String(i + 8).padStart(2, "0") + ":00</option>").join("")}</select></label><label>Consultation format<select name="meetingType"><option value="zoom">Zoom</option><option value="in-person">In person</option></select></label><label>In-person meeting address<input name="meetingLocation" placeholder="Required when testing in person"></label><label>Shoot end time<select name="preferredEndTime">${Array.from({ length: 9 }, (_, i) => "<option>" + String(i + 9).padStart(2, "0") + ":00</option>").join("")}</select></label><label>Shoot package<select name="package"><option>Aerial Photo</option><option>Photo + Video</option><option>Signature Media</option></select></label><label>Additional service<select name="service"><option value="">None</option><option>Ground Photography</option><option>Ground Video</option></select></label><label>Add-on<select name="addon"><option value="">None</option><option>Raw Footage</option><option>24-Hour Rush</option><option>Vertical Social Version</option></select></label><label>Project details<textarea name="description" required>End-to-end Stripe sandbox test. No real appointment.</textarea></label><button>Continue to Stripe Test Checkout</button></form><p id="status"></p><script>const form=document.getElementById('booking');form.onsubmit=async(e)=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const data=Object.fromEntries(new FormData(form));data.services=data.service?[data.service]:[];data.addons=data.addon?[data.addon]:[];const r=await fetch('/api/stripe/test-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error);location.href=d.url;}catch(e){document.getElementById('status').textContent=e.message;b.disabled=false;}};const order=new URLSearchParams(location.search).get('order');if(order){form.hidden=true;document.getElementById('status').textContent='Waiting for verified Stripe payment and booking confirmation…';let attempts=0;const check=async()=>{const r=await fetch('/api/stripe/test-status?order='+encodeURIComponent(order));const d=await r.json();document.getElementById('status').textContent=d.receipt_id?'Sandbox booking confirmed. Confirmation and separate paid receipt sent.':d.state==='paid'?'Payment verified. Finishing Calendar and email delivery…':'Waiting for verified payment…';if(!d.receipt_id&&++attempts<30)setTimeout(check,2000);};check();}</script></html>`;
const html = (body) =>
  new Response(body, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex,nofollow",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(retryPendingPayments(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/api/stripe/webhook" && request.method === "POST")
      return webhook(request, env);
    // Opt-in public-form sandbox routing. Disabled by default until the matching
    // frontend has been published. This flag cannot enable live payments.
    if (
      env.STRIPE_PUBLIC_FORM_TESTING === "true" &&
      request.method === "POST" &&
      ["/api/consultation", "/api/shoot-request"].includes(path) &&
      (await authorized(request))
    ) {
      const body = await request.json();
      body.kind = path === "/api/consultation" ? "consultation" : "shoot";
      return checkout(
        new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
      );
    }
    if (!path.startsWith("/api/stripe/test-"))
      return legacy.fetch(request, env, ctx);
    if (path === "/api/stripe/test-login" && request.method === "POST") {
      const body = await request.formData(),
        token = String(body.get("token") || "");
      if (!(await tokenValid(token)))
        return reply({ error: "Invalid access code" }, 401);
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/api/stripe/test-booking",
          "Set-Cookie":
            "mm_stripe_test=" +
            token +
            "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400",
          "Cache-Control": "no-store",
        },
      });
    }
    if (!(await authorized(request)))
      return path === "/api/stripe/test-booking"
        ? html(login)
        : reply({ error: "Protected sandbox. Test access required." }, 401);
    if (path === "/api/stripe/test-retry" && request.method === "POST")
      return reply({ results: await retryPendingPayments(env) });
    if (path === "/api/stripe/test-booking") return html(page);
    if (path === "/api/stripe/test-checkout" && request.method === "POST")
      return checkout(request, env);
    if (path === "/api/stripe/test-status") {
      const order = await env.DB.prepare(
        "SELECT id,state,amount,session_id,event_id,signature_verified,contact_id,calendar_id,confirmation_id,receipt_id,last_error FROM stripe_test_orders WHERE id=?",
      )
        .bind(url.searchParams.get("order"))
        .first();
      if (order?.calendar_id && url.searchParams.get("verify") === "1")
        order.calendarVerification = await verifyCalendar(
          env,
          order.calendar_id,
        );
      return reply(order || { error: "Not found" }, order ? 200 : 404);
    }
    if (path === "/api/stripe/test-config") {
      const stripe = sdk(env),
        account = await stripe.accounts.retrieve(),
        balance = await stripe.balance.retrieve(),
        hooks = await stripe.webhookEndpoints.list({ limit: 100 });
      return reply({
        accountId: account.id,
        livemode: balance.livemode,
        webhooks: hooks.data.map((x) => ({
          id: x.id,
          url: x.url,
          status: x.status,
          livemode: x.livemode,
          enabled_events: x.enabled_events,
        })),
        webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
        tax: await (async () => {
          try {
            const settings = await stripe.tax.settings.retrieve();
            const registrations = await stripe.tax.registrations.list({
              status: "active",
              limit: 100,
            });
            return {
              status: settings.status,
              defaults: settings.defaults,
              registrations: registrations.data.map((r) => ({
                country: r.country,
                country_options: r.country_options,
                status: r.status,
              })),
            };
          } catch (e) {
            return { error: e.code || e.type || "tax_read_failed" };
          }
        })(),
      });
    }
    return reply({ error: "Not found" }, 404);
  },
};
