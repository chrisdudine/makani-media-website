import test from "node:test";
import assert from "node:assert/strict";
import { deliverBookingEmails } from "../worker/src/booking-email.js";

test("sends customer confirmation and complete business notification", async () => {
  const messages = [];
  const env = {
    BOOKING_EMAIL_FROM: "bookings@mail.makani-media.com",
    BOOKING_NOTIFICATION_EMAIL: "makanimediamaui@gmail.com",
    EMAIL: {
      async send(message) {
        messages.push(message);
        return { messageId: `message-${messages.length}` };
      },
    },
  };

  const messageIds = await deliverBookingEmails(env, {
    kind: "shoot",
    projectId: "project-123",
    body: {
      name: "Test Client",
      email: "TEST@example.com",
      phone: "808-555-0100",
      business: "Test Business",
      preferredDate: "2026-10-12",
      preferredTime: "10:00",
      location: "Wailea, Maui",
      projectType: "Commercial real estate",
      package: "Photo + Video",
      frequency: "One-time shoot",
      services: ["Drone Video", "Ground Photography"],
      addons: ["Raw Footage", "24-Hour Rush"],
      budget: "$1,000–$2,500",
      accessDetails: "Call at gate",
      description: "Aerial photos and a promotional video.",
      questions: "Can this be delivered within one week?",
    },
  });

  assert.deepEqual(messageIds, ["message-1", "message-2"]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].to, "test@example.com");
  assert.equal(messages[0].attachments.length, 1);
  assert.equal(messages[0].attachments[0].type, "application/pdf");
  assert.equal(messages[0].attachments[0].disposition, "attachment");
  assert.equal(
    new TextDecoder().decode(messages[0].attachments[0].content.slice(0, 8)),
    "%PDF-1.4",
  );
  assert.match(messages[0].text, /preliminary estimate is \$675/i);
  assert.match(
    messages[0].text,
    /Thank you for choosing Makani Media.*bring your vision to life\./s,
  );
  assert.match(
    messages[0].text,
    /We’re grateful for the opportunity.*creating something exceptional with you\./s,
  );
  assert.match(messages[0].text, /Warmly,\n\nMakani Media/);

  const internal = messages[1];
  assert.equal(internal.to, "makanimediamaui@gmail.com");
  assert.equal(internal.replyTo, "test@example.com");
  assert.match(
    internal.subject,
    /New Shoot Request — Test Client — 2026-10-12/,
  );
  for (const detail of [
    "808-555-0100",
    "Test Business",
    "Wailea, Maui",
    "Commercial real estate",
    "Photo + Video",
    "One-time shoot",
    "Drone Video, Ground Photography",
    "Raw Footage, 24-Hour Rush",
    "$1,000–$2,500",
    "Call at gate",
    "Aerial photos and a promotional video.",
    "Can this be delivered within one week?",
    "Preliminary estimate: $675",
  ]) {
    assert.match(
      internal.text,
      new RegExp(detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
