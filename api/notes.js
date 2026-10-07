// Reads the practice notes with the server-only Supabase key.
// Still a public endpoint: anyone with the URL can read the notes until login is added.
import { createClient } from '@supabase/supabase-js';

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
