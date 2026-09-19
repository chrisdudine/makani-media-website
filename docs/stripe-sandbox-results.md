# Stripe sandbox integration — September 19, 2026

## Outcome and scope

Two real Stripe-hosted sandbox Checkout flows passed: consultation $103.66 and a variable-price shoot $625.00. No live keys, live payments, or real card details were used. Both Stripe secrets remain protected Cloudflare bindings.

The deployed `makani-media-api` Worker now handles `/api/stripe/webhook` and a protected test booking page at `/api/stripe/test-booking`. The existing public booking forms still use the previous request workflow. This is a verified sandbox integration, not a production payment launch. Do not merge and describe it as live-ready.

The sandbox only allows the business test mailbox, labels Calendar entries and emails as test-only, rejects live keys/events, and has time-limited access. The committed access hash is not the access token. The token is kept outside the repository; access expires after the test window. The previous deployed Worker was backed up locally before replacement; bindings were preserved by Cloudflare's content-only API.

## End-to-end evidence

| Checkpoint                                   | Consultation            | Shoot                   |
| -------------------------------------------- | ----------------------- | ----------------------- |
| Customer details → hosted Checkout           | PASS, $103.66           | PASS, $625.00           |
| Stripe test card payment                     | PASS                    | PASS                    |
| Signed webhook received and verified         | PASS                    | PASS                    |
| Customer/project/booking in D1               | PASS                    | PASS                    |
| Google Calendar creation and independent GET | PASS                    | PASS                    |
| Booking confirmation email                   | PASS, provider accepted | PASS, provider accepted |
| Separate paid receipt email                  | PASS, provider accepted | PASS, provider accepted |

Email acknowledgement confirms that Cloudflare accepted each message; inbox arrival/spam placement has not been independently inspected. Four messages were sent to `makanimediamaui@gmail.com`. Two clearly labeled test Calendar entries remain, December 18 and 19, 2026, starting 08:00 HST. These test bookings currently reserve those slots and should be canceled/cleaned up before launch.

Account: `acct_1UGiWxLUX1ZnaFl6` (verified livemode false).
Webhook destination: `we_1UGuQYLUX1ZnaFl69ne7yTPK`.

Consultation booking `2757f6fb-c27a-4c47-b13c-98408ef038c2`:

- Session `cs_test_a1mAZ3yHyf2PAqrOhRAE5AnJq3gaKLhRz81nYP0KvgKAtr204Tu8fWUsHq`
- Verified event `evt_1UHRDNLUX1ZnaFl6aoGE98No`
- Payment `pi_3UHRDJLUX1ZnaFl612eqxJvY`
- Invoice `in_1UHRDKLUX1ZnaFl6MSmwg7X0`
- Calendar `m2757f6fbc27a4c47b13c98408ef038c2`

Shoot booking `fcb554f2-48bb-465a-ae1e-11b1a037b107`:

- Session `cs_test_a1llJ3pebaFFOsATEZv0CnoAQOyED8k3PM8RnQewqj6x7xMOSJWJLW7ZsG`
- Verified event `evt_1UHRG2LUX1ZnaFl6AaD2sulS`
- Payment `pi_3UHRFyLUX1ZnaFl61RrwwCIk`
- Invoice `in_1UHRG0LUX1ZnaFl6bcbO1lBC`
- Calendar `mfcb554f248bb465aae1e11b1a037b107`

Shoot price: Aerial Photo $225 + additional hour $150 + Ground Photography $150 + Raw Footage $100. Prices are computed on the server; unknown/custom services are rejected pending a quote. Duplicate add-ons are deduplicated.

## Security and failure checks

`pnpm test:stripe`: 10 passed. Covers live-key rejection, fixed and variable pricing, controlled email recipient, bad dates, invalid/expired signatures, live-event rejection, unpaid events, server-retrieved amount mismatch, duplicate webhook replay and email retry. D1 behavior is exercised with SQLite. The deployed webhook independently rejected an unsigned payment event with HTTP 400. Protected endpoints rejected missing test credentials with HTTP 401.

A failed fulfillment step returns HTTP 503 so Stripe retries. Calendar creation uses a deterministic event ID. Persisted step acknowledgements avoid repeating completed work. Email delivery is at-least-once: a crash between provider acceptance and recording its message ID can cause a duplicate; there is no provider idempotency claim. Stripe customer creation currently happens per Checkout; D1 deduplicates contacts by email and stores each order's Stripe customer ID.

The old baseline-dependent `pnpm test` suite was not used as evidence; its worker fixtures refer to an external historical baseline. The focused Stripe suite and existing estimate/email tests were run.

## Tax and launch blockers

User requested confirmation of the tax breakdown before launch. The verified Stripe sandbox's Tax settings are `pending`, with no default tax code/behavior and no active registrations. Automatic tax remains off. Neither tax registrations nor legal classifications were invented.

The requested total matches a possible calculation: $99.00 × 4.712% = $4.66488, rounded to $4.66; total $103.66. This is a mathematical match, not confirmation of the intended base price or the merchant's tax obligations.

Hawaii publishes Maui's maximum GET pass-on rate as 4.7120%. Stripe Tax supports Hawaii GET using the maximum pass-on rate. Before enabling it, confirm the $99 base price, the applicable service classification/performance location, the business's GET registration, and Stripe Tax settings/registrations in the intended environment. Do not add tax on top of $103.66 by default.

Sources:

- https://tax.hawaii.gov/geninfo/countysurcharge/
- https://docs.stripe.com/tax/supported-countries/united-states/collect-tax?tax-jurisdiction-united-states=hawaii
- https://docs.stripe.com/tax/set-up

Before launch: resolve tax setup, adapt and test the public forms/customer emails, add durable fulfillment recovery beyond Stripe's retry window, unify reservation checks across test/legacy/new routes, remove the temporary sandbox access surface, clean up test reservations, and configure separately authorized live credentials and a live webhook. Live charges remain deliberately disabled.
