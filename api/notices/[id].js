// GET /api/notices/:id: one class notice for any verified login. Writes are refused here for everyone;
// instructors change notices only through /api/admin/notices/:id after a server-side instructor check.
import { UUID, dbFailure, markResource, noticesTable, requireLogin, sendError, toNote } from '../../src/notes-server.mjs';

export default async function handler(request, response) {
  markResource(request, response, '/api/notices/:id');
  const login = await requireLogin(request, response);
  if (!login) return;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return sendError(response, 403, 'NOTICE_READ_ONLY');
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const id = request.query?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return sendError(response, 404, 'NOTICE_NOT_FOUND');
  const { data, error } = await noticesTable().select('id, title, content').eq('id', id).limit(1);
  if (error) return dbFailure(response, error, 'NOTICES_UNAVAILABLE');
  return data.length ? response.status(200).json(toNote(data[0])) : sendError(response, 404, 'NOTICE_NOT_FOUND');
}
