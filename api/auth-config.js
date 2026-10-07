// GET /api/auth-config: the browser login settings, read at runtime from Vercel environment variables
// so no Supabase key is written into static files. Only the public (publishable/anon) key may leave here.
import { sendError } from '../src/notes-server.mjs';

const roleOf = key => {
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
  } catch {
    return null;
  }
};

const isPublicKey = key => key.startsWith('sb_publishable_')
  || (/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/u.test(key) && roleOf(key) === 'anon');

export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) {
    return sendError(response, 500, 'AUTH_NOT_CONFIGURED', '로그인 설정이 서버에 없습니다.');
  }
  if (!isPublicKey(publishableKey)) {
    console.error('SUPABASE_PUBLISHABLE_KEY is not a publishable or anon key; refusing to send it');
    return sendError(response, 500, 'AUTH_NOT_CONFIGURED', '로그인 설정이 서버에 없습니다.');
  }
  return response.status(200).json({ supabaseUrl, publishableKey });
}
