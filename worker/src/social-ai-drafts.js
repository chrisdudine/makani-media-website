import { downloadMedia, generateDraft, DraftError } from "./social-ai-media.js";

const MAX_ATTEMPTS = 3;
const LEASE_MS = 10 * 60_000;
const untouched = `c.source_provider='google-drive' AND c.source_file_id<>''
  AND c.caption='' AND c.ai_metadata_json='{}'
  AND NOT EXISTS (SELECT 1 FROM social_content_targets t WHERE t.content_id=c.id)`;
const owned = `EXISTS (SELECT 1 FROM social_generation_jobs j
  WHERE j.content_id=social_content.id AND j.status='processing'
    AND j.lease_token=? AND j.lease_expires_at>?)`;
const adapters = [
  ["instagram", "instagram"],
  ["linkedin", "linkedin"],
  ["google-business-profile", "google_business_profile"],
];

async function claim(DB, now) {
  // Only new, untouched inbox entries are enrolled. Never recreate a failed job.
  await DB.prepare(
    `INSERT OR IGNORE INTO social_generation_jobs
    (content_id,next_attempt_at,created_at,updated_at)
    SELECT c.id,?,?,? FROM social_content c
    WHERE c.workflow_state='inbox' AND ${untouched}
      AND NOT EXISTS (SELECT 1 FROM social_generation_jobs j WHERE j.content_id=c.id)
    ORDER BY c.created_at,c.id LIMIT 25`,
  )
    .bind(now, now, now)
    .run();

  // A crashed third attempt must not leave an item stuck in processing forever.
  await DB.batch([
    DB.prepare(
      `UPDATE social_content SET workflow_state='review',updated_at=?
      WHERE workflow_state='processing' AND caption='' AND ai_metadata_json='{}'
      AND NOT EXISTS (SELECT 1 FROM social_content_targets t WHERE t.content_id=social_content.id) AND id IN
      (SELECT content_id FROM social_generation_jobs WHERE status='processing' AND attempts>=? AND lease_expires_at<=?)`,
    ).bind(now, MAX_ATTEMPTS, now),
    DB.prepare(
      `UPDATE social_generation_jobs SET status='failed',error_code='LEASE_EXHAUSTED',lease_token='',lease_expires_at=NULL,updated_at=?
      WHERE status='processing' AND attempts>=? AND lease_expires_at<=?`,
    ).bind(now, MAX_ATTEMPTS, now),
    DB.prepare(
      `UPDATE social_generation_jobs SET status='cancelled',error_code='CONTENT_EDITED',lease_token='',lease_expires_at=NULL,updated_at=?
      WHERE status IN ('pending','retry','processing') AND NOT EXISTS
      (SELECT 1 FROM social_content c WHERE c.id=content_id AND c.workflow_state IN ('inbox','processing') AND ${untouched})`,
    ).bind(now),
  ]);

  const token = crypto.randomUUID();
  const expires = new Date(Date.parse(now) + LEASE_MS).toISOString();
  const result = await DB.batch([
    DB.prepare(
      `UPDATE social_generation_jobs SET status='processing',attempts=attempts+1,
      lease_token=?,lease_expires_at=?,updated_at=?
      WHERE content_id=(SELECT j.content_id FROM social_generation_jobs j
        JOIN social_content c ON c.id=j.content_id
        WHERE j.attempts<? AND ${untouched} AND
          ((j.status IN ('pending','retry') AND j.next_attempt_at<=? AND c.workflow_state='inbox')
           OR (j.status='processing' AND j.lease_expires_at<=? AND c.workflow_state='processing'))
        ORDER BY j.next_attempt_at,j.content_id LIMIT 1)
      RETURNING content_id,attempts`,
    ).bind(token, expires, now, MAX_ATTEMPTS, now, now),
    DB.prepare(
      `UPDATE social_content SET workflow_state='processing',updated_at=?
      WHERE id=(SELECT content_id FROM social_generation_jobs WHERE lease_token=? AND status='processing')`,
    ).bind(now, token),
  ]);
  const job = result[0].results?.[0];
  if (!job) return null;
  const content = await DB.prepare(
    "SELECT id,source_file_id FROM social_content WHERE id=?",
  )
    .bind(job.content_id)
    .first();
  return { ...job, ...content, token, claimedAt: now };
}

async function saveDraft(DB, job, generated, media, now) {
  const { draft, model } = generated;
  const metadata = JSON.stringify({
    schema_version: 1,
    provider: "gemini",
    model,
    generated_at: now,
    source_version: media.file.version || null,
    source_modified_at: media.file.modifiedTime || null,
    mime_type: media.file.mimeType,
    summary: draft.summary,
    subjects: draft.subjects,
    review_notes: draft.review_notes,
    platform_drafts: draft.platforms,
    requires_human_approval: true,
  });
  const saved = `SELECT c.id FROM social_content c JOIN social_generation_jobs j ON j.content_id=c.id
    WHERE c.id=? AND c.workflow_state='review' AND c.ai_metadata_json=?
      AND j.status='processing' AND j.lease_token=? AND j.lease_expires_at>?`;
  const statements = [
    DB.prepare(
      `UPDATE social_content SET caption=?,ai_metadata_json=?,workflow_state='review',updated_at=?
    WHERE id=? AND source_file_id=? AND workflow_state='processing' AND updated_at=?
      AND caption='' AND ai_metadata_json='{}'
      AND NOT EXISTS (SELECT 1 FROM social_content_targets t WHERE t.content_id=social_content.id)
      AND ${owned}`,
    ).bind(
      draft.caption,
      metadata,
      now,
      job.id,
      job.source_file_id,
      job.claimedAt,
      job.token,
      now,
    ),
  ];
  for (const [platform, key] of adapters) {
    // Store review-only drafts even for disabled accounts; never enable/publish them.
    statements.push(
      DB.prepare(
        `INSERT INTO social_content_targets
      (id,content_id,account_id,platform,platform_caption,publish_status,created_at,updated_at)
      SELECT 'ai-draft:' || ? || ':' || a.id,?,a.id,a.platform,?,'draft',?,?
      FROM social_accounts a WHERE a.platform=? AND EXISTS (${saved})
      ON CONFLICT(content_id,account_id) DO NOTHING`,
      ).bind(
        job.id,
        job.id,
        draft.platforms[key],
        now,
        now,
        platform,
        job.id,
        metadata,
        job.token,
        now,
      ),
    );
  }
  statements.push(
    DB.prepare(
      `UPDATE social_generation_jobs SET status='succeeded',model=?,error_code='',lease_token='',lease_expires_at=NULL,updated_at=?
    WHERE content_id IN (${saved})`,
    ).bind(model, now, job.id, metadata, job.token, now),
  );
  statements.push(
    DB.prepare(
      `UPDATE social_generation_jobs SET status='cancelled',error_code='CONTENT_EDITED',lease_token='',lease_expires_at=NULL,updated_at=?
    WHERE content_id=? AND status='processing' AND lease_token=? AND lease_expires_at>?`,
    ).bind(now, job.id, job.token, now),
  );
  const results = await DB.batch(statements);
  return results[0].meta.changes === 1;
}

async function recordFailure(DB, job, error, now) {
  const known = error instanceof DraftError;
  const retry = (known ? error.retryable : true) && job.attempts < MAX_ATTEMPTS;
  const code = known ? error.code : "INTERNAL_ERROR";
  const next = new Date(
    Date.parse(now) + (job.attempts === 1 ? 5 : 15) * 60_000,
  ).toISOString();
  // A human edit made during an API call wins, including edits to workflow state.
  const results = await DB.batch([
    DB.prepare(
      `UPDATE social_content SET workflow_state=?,updated_at=?
      WHERE id=? AND workflow_state='processing' AND updated_at=? AND caption='' AND ai_metadata_json='{}'
      AND NOT EXISTS (SELECT 1 FROM social_content_targets t WHERE t.content_id=social_content.id)
      AND ${owned}`,
    ).bind(
      retry ? "inbox" : "review",
      now,
      job.id,
      job.claimedAt,
      job.token,
      now,
    ),
    DB.prepare(
      `UPDATE social_generation_jobs SET status=?,error_code=?,next_attempt_at=?,lease_token='',lease_expires_at=NULL,updated_at=?
      WHERE content_id=? AND status='processing' AND lease_token=? AND lease_expires_at>?
      AND EXISTS (SELECT 1 FROM social_content c WHERE c.id=content_id AND c.workflow_state=? AND c.updated_at=? AND c.caption='' AND c.ai_metadata_json='{}')`,
    ).bind(
      retry ? "retry" : "failed",
      code,
      next,
      now,
      job.id,
      job.token,
      now,
      retry ? "inbox" : "review",
      now,
    ),
    DB.prepare(
      `UPDATE social_generation_jobs SET status='cancelled',error_code='CONTENT_EDITED',lease_token='',lease_expires_at=NULL,updated_at=?
      WHERE content_id=? AND status='processing' AND lease_token=? AND lease_expires_at>?`,
    ).bind(now, job.id, job.token, now),
  ]);
  return {
    status: results[0].meta.changes
      ? retry
        ? "retry"
        : "failed"
      : "superseded",
    error_code: code,
    ...(known && error.diagnostic ? { error_detail: error.diagnostic } : {}),
  };
}

export async function processSocialDrafts(env, dependencies = {}) {
  if (env.SOCIAL_AI_ENABLED !== "true") return { status: "disabled" };
  if (!env.DB) throw new DraftError("MISSING_DB");
  // Do not consume a job's retry budget when the deployment lacks credentials.
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN ||
    !env.GEMINI_API_KEY
  )
    throw new DraftError("MISSING_AI_CREDENTIALS");
  const clock = dependencies.now || (() => new Date().toISOString());
  const job = await claim(env.DB, clock());
  if (!job) return { status: "idle" };
  try {
    const media = await (dependencies.download || downloadMedia)(
      env,
      job.source_file_id,
    );
    const generated = await (dependencies.generate || generateDraft)(
      env,
      media,
    );
    await media.assertUnchanged();
    const saved = await saveDraft(env.DB, job, generated, media, clock());
    return {
      status: saved ? "review" : "superseded",
      content_id: job.id,
      attempts: job.attempts,
    };
  } catch (error) {
    return {
      ...(await recordFailure(env.DB, job, error, clock())),
      content_id: job.id,
      attempts: job.attempts,
    };
  }
}
