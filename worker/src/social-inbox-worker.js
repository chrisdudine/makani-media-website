import booking from "./booking-wrapper.js";
import { ingestDriveInbox } from "./social-drive-inbox.js";

export default {
  // Keep every existing Calendar and booking request on its original handler.
  fetch: booking.fetch,
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
  },
};
