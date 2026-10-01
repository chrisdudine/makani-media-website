import booking from "./booking-wrapper.js";
import { ingestDriveInbox } from "./social-drive-inbox.js";
import { processSocialDrafts } from "./social-ai-drafts.js";
import { verifySocialAiAccess } from "./social-ai-media.js";
import { reviewRequest } from "./social-review.js";

export default {
  // Keep every existing Calendar and booking request on its original handler.
  async fetch(request, env, ctx) {
    const review = await reviewRequest(request, env);
    return review || booking.fetch(request, env, ctx);
  },
  async scheduled(_controller, env) {
    try {
      const result = await ingestDriveInbox(env);
      console.log(JSON.stringify({ event: "social_drive_inbox", ...result }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "social_drive_inbox_failed",
          message: error.message,
        }),
      );
      throw error;
    }
    if (env.SOCIAL_AI_VERIFY === "true" || env.SOCIAL_AI_ENABLED === "true") {
      try {
        const result =
          env.SOCIAL_AI_VERIFY === "true"
            ? await verifySocialAiAccess(env)
            : await processSocialDrafts(env);
        console.log(JSON.stringify({ event: "social_ai_drafts", ...result }));
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "social_ai_drafts_failed",
            error_code: error.code || "INTERNAL_ERROR",
          }),
        );
        throw new Error(
          "Social AI drafting failed; inspect the structured error code",
        );
      }
    }
  },
};
