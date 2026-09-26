export const SOCIAL_DRIVE_FOLDER_ID = "16M72Ioa-KtWd0jpbx_Gqee42NHtbqIXO";

async function googleToken(env) {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  )
    throw new Error("Google OAuth credentials are not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Google OAuth refresh failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token)
    throw new Error("Google OAuth returned no access token");
  return data.access_token;
}

async function driveJson(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`Drive inbox lookup failed (${response.status})`);
  return response.json();
}

// Metadata only: never download, move, modify, or publish Drive files.
export async function ingestDriveInbox(env) {
  if (!env.DB) throw new Error("Social inbox database is not configured");
  const token = await googleToken(env);
  const folderUrl = new URL(
    `https://www.googleapis.com/drive/v3/files/${SOCIAL_DRIVE_FOLDER_ID}`,
  );
  folderUrl.search = new URLSearchParams({
    fields: "id,mimeType,trashed",
    supportsAllDrives: "true",
  });
  const folder = await driveJson(folderUrl, token);
  if (
    folder.id !== SOCIAL_DRIVE_FOLDER_ID ||
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    folder.trashed
  )
    throw new Error("Social inbox folder is unavailable");

  const result = { scanned: 0, inserted: 0, existing: 0, skipped: 0, pages: 0 };
  let pageToken;
  const seenPageTokens = new Set();
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.search = new URLSearchParams({
      q: `'${SOCIAL_DRIVE_FOLDER_ID}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
      fields:
        "nextPageToken,incompleteSearch,files(id,name,mimeType,parents,trashed)",
      pageSize: "1000",
      spaces: "drive",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await driveJson(url, token);
    if (page.incompleteSearch || !Array.isArray(page.files))
      throw new Error("Drive returned an incomplete inbox listing");
    result.pages++;
    const statements = [];
    for (const file of page.files) {
      result.scanned++;
      const mediaType = file.mimeType?.startsWith("image/")
        ? "image"
        : file.mimeType?.startsWith("video/")
          ? "video"
          : null;
      if (
        !mediaType ||
        !file.id ||
        typeof file.name !== "string" ||
        file.trashed ||
        !file.parents?.includes(SOCIAL_DRIVE_FOLDER_ID)
      ) {
        result.skipped++;
        continue;
      }
      const now = new Date().toISOString();
      statements.push(
        env.DB.prepare(
          `INSERT INTO social_content
           (id, source_provider, source_file_id, source_file_name, media_type, workflow_state, created_at, updated_at)
         VALUES (?, 'google-drive', ?, ?, ?, 'inbox', ?, ?)
         ON CONFLICT(source_provider, source_file_id)
           WHERE source_provider = 'google-drive' AND source_file_id <> ''
         DO NOTHING`,
        ).bind(
          `google-drive:${file.id}`,
          file.id,
          file.name,
          mediaType,
          now,
          now,
        ),
      );
    }
    // Small atomic batches; the unique index also protects overlapping runs.
    for (let offset = 0; offset < statements.length; offset += 50) {
      const batch = await env.DB.batch(statements.slice(offset, offset + 50));
      for (const row of batch) {
        if (!row.success) throw new Error("Social inbox insert failed");
        result.inserted += row.meta.changes;
        result.existing += row.meta.changes === 0 ? 1 : 0;
      }
    }
    pageToken = page.nextPageToken;
    if (pageToken && seenPageTokens.has(pageToken))
      throw new Error("Drive returned a repeated page token");
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);
  return result;
}
