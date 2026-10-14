// GET /api/notices: class notices for any verified login. Writes are refused here for everyone;
// instructors change notices only through /api/admin/notices/:id after a server-side instructor check.
import { dbFailure, markResource, noticesTable, requireLogin, sendError, toNote } from '../src/notes-server.mjs';

export default async function handler(request, response) {
  markResource(request, response, '/api/notices');
  const login = await requireLogin(request, response);
  if (!login) return;

  if (request.method === 'GET') {
    const { data, error } = await noticesTable().select('id, title, content').order('created_at');
    if (error) return dbFailure(response, error, 'NOTICES_UNAVAILABLE');
    return response.status(200).json(data.map(toNote));
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return sendError(response, 403, 'NOTICE_READ_ONLY');
  }
  response.setHeader('Allow', 'GET');
  return sendError(response, 405, 'METHOD_NOT_ALLOWED');
}
