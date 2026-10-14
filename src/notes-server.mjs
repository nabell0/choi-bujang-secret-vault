// Shared by the notes API routes. Login is checked only by the template helper in verify-login.mjs;
// identity comes from the verified token alone and request userId/role/owner_id values are never read.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { resourceForApiRoute } from './decider.mjs';
import { createLoginVerifier } from './verify-login.mjs';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_MAX = 200;
const BODY_MAX = 5000;

let verifyLogin;
let supabase;

export function sendError(response, status, error, message) {
  return response.status(status).json(message ? { error, message } : { error });
}

// Labels every response, including login errors, with the resource ID the decider uses for the same route.
export function markResource(request, response, apiPath) {
  const resource = resourceForApiRoute(request.method, apiPath);
  if (resource) response.setHeader('X-Aleph-Resource', `${resource.id}; zone=${resource.zone}`);
  return resource;
}

// Returns the verified login, or null after a JSON error response has been sent.
export async function requireLogin(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    sendError(response, 500, 'NOTES_NOT_CONFIGURED');
    return null;
  }
  try {
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
    supabase ??= createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch (error) {
    console.error('login verifier setup failed', error.message);
    sendError(response, 500, 'LOGIN_NOT_CONFIGURED');
    return null;
  }
  const authorization = request.headers?.authorization;
  if (!authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    sendError(response, 401, 'LOGIN_REQUIRED', '로그인이 필요합니다.');
    return null;
  }
  const login = await verifyLogin(authorization);
  if (!login) {
    response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    sendError(response, 401, 'INVALID_LOGIN_TOKEN', '로그인 토큰을 확인할 수 없습니다. 다시 로그인해 주세요.');
    return null;
  }
  return login;
}

export const notesTable = () => supabase.from('notes');
export const noticesTable = () => supabase.from('notices');
export const noteBackupTable = () => supabase.from('notes_backup');
export const restoreAuditTable = () => supabase.from('note_restore_audit');

// Same formula as supabase/step10-note-backup.sql: SHA-256 of "<title UTF-8 byte length>:<title><content>".
export function noteContentSha256(title, content) {
  return createHash('sha256')
    .update(`${Buffer.byteLength(title, 'utf8')}:${title}${content}`, 'utf8').digest('hex');
}

export const toNote = row => ({ id: row.id, title: row.title, body: row.content });

// Instructors come only from the server-side INSTRUCTOR_USER_IDS list in Vercel settings. A token's role claim,
// the request body, headers, query, and the screen menu never make someone an instructor. Judge logins never are.
export function isInstructor(login) {
  if (login?.kind !== 'student') return false;
  const ids = (process.env.INSTRUCTOR_USER_IDS ?? '').split(',')
    .map(value => value.trim().toLowerCase()).filter(value => UUID.test(value));
  return ids.includes(login.userId.toLowerCase());
}

export function dbFailure(response, error, code = 'NOTES_UNAVAILABLE') {
  // Log only the error code; messages and request details stay out of logs.
  console.error('data query failed', error.code ?? 'unknown');
  return sendError(response, 502, code);
}

// Instructor materials are closed to every login on this server; there is no materials data behind it.
export async function closedMaterials(request, response, apiPath) {
  markResource(request, response, apiPath);
  if (!await requireLogin(request, response)) return;
  return sendError(response, 403, 'MATERIALS_ZONE_FORBIDDEN');
}

// True when the body names an owner other than the verified user. The owner is never taken from the body.
export function requestsOtherOwner(request, userId) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return false; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return ['owner_id', 'ownerId'].some(key => Object.hasOwn(body, key)
    && String(body[key]).toLowerCase() !== userId.toLowerCase());
}

export function refuseOwnerChange(response) {
  return sendError(response, 403, 'OWNER_CHANGE_FORBIDDEN', '메모 소유자는 바꿀 수 없습니다.');
}

// Reads only id/title/body from a JSON object body; any other field is ignored.
export function readNoteInput(request, { allowId }) {
  let body;
  try {
    body = request.body;
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return { error: 'INVALID_JSON', message: 'JSON 형식의 요청 본문이 필요합니다.' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_NOTE', message: '{title, body} 형식의 JSON 객체가 필요합니다.' };
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > TITLE_MAX) {
    return { error: 'INVALID_TITLE', message: `제목은 1~${TITLE_MAX}자 문자열이어야 합니다.` };
  }
  if (typeof body.body !== 'string' || body.body.length > BODY_MAX) {
    return { error: 'INVALID_BODY', message: `내용은 ${BODY_MAX}자 이하 문자열이어야 합니다.` };
  }
  if (allowId && body.id !== undefined && (typeof body.id !== 'string' || !UUID.test(body.id))) {
    return { error: 'INVALID_NOTE_ID', message: '메모 ID는 UUID여야 합니다.' };
  }
  return { id: allowId ? body.id?.toLowerCase() : undefined, title, body: body.body };
}
