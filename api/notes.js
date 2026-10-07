// Reads the practice notes with the server-only Supabase key, only for a verified login token.
// Identity comes from the verified token alone; request userId/role values are never read.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

let verifyLogin;

function loginVerifier(secretKey) {
  verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
  return verifyLogin;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
  }
  let verify;
  try {
    verify = loginVerifier(secretKey);
  } catch (error) {
    console.error('login verifier setup failed', error.message);
    return response.status(500).json({ error: 'LOGIN_NOT_CONFIGURED' });
  }
  const authorization = request.headers?.authorization;
  if (!authorization) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'LOGIN_REQUIRED', message: '로그인이 필요합니다.' });
  }
  const login = await verify(authorization);
  if (!login) {
    response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return response.status(401).json({ error: 'INVALID_LOGIN_TOKEN', message: '로그인 토큰을 확인할 수 없습니다. 다시 로그인해 주세요.' });
  }
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.from('notes').select('title, content').order('id');
  if (error) {
    // Log only the error code; messages and request details stay out of logs.
    console.error('notes query failed', error.code ?? 'unknown');
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
  return response.status(200).json({ notes: data });
}
