// PUT/DELETE /api/admin/notices/:id: the separate instructor path for changing class notices.
// The decider never allows this path; this server checks the verified login against INSTRUCTOR_USER_IDS itself.
import {
  UUID, dbFailure, isInstructor, markResource, noticesTable, readNoteInput, requireLogin, sendError, toNote,
} from '../../../src/notes-server.mjs';
import { requireApprovedDevice } from '../../../src/device-auth.mjs';

export default async function handler(request, response) {
  markResource(request, response, '/api/admin/notices/:id');
  const login = await requireLogin(request, response);
  if (!login) return;
  if (!await requireApprovedDevice(request, response, login, '/api/admin/notices/:id')) return;
  if (!isInstructor(login)) return sendError(response, 403, 'INSTRUCTOR_ONLY');

  const id = request.query?.id;
  if (typeof id !== 'string' || !UUID.test(id)) return sendError(response, 404, 'NOTICE_NOT_FOUND');

  if (request.method === 'PUT') {
    const input = readNoteInput(request, { allowId: false });
    if (input.error) return sendError(response, 400, input.error, input.message);
    const { data, error } = await noticesTable()
      .update({ title: input.title, content: input.body, updated_at: new Date().toISOString() })
      .eq('id', id).select('id, title, content');
    if (error) return dbFailure(response, error, 'NOTICES_UNAVAILABLE');
    return data.length ? response.status(200).json(toNote(data[0])) : sendError(response, 404, 'NOTICE_NOT_FOUND');
  }

  if (request.method === 'DELETE') {
    const { data, error } = await noticesTable().delete().eq('id', id).select('id');
    if (error) return dbFailure(response, error, 'NOTICES_UNAVAILABLE');
    return data.length ? response.status(204).end() : sendError(response, 404, 'NOTICE_NOT_FOUND');
  }

  response.setHeader('Allow', 'PUT, DELETE');
  return sendError(response, 405, 'METHOD_NOT_ALLOWED');
}
