// GET/PUT/DELETE /api/notes/:id
// Known gap until stage 4: there is no owner check, so any logged-in user can read, change,
// or delete any note whose id they know.
import { UUID, dbFailure, notesTable, readNoteInput, requireLogin, sendError, toNote } from '../../src/notes-server.mjs';

export default async function handler(request, response) {
  const login = await requireLogin(request, response);
  if (!login) return;

  const id = request.query?.id;
  if (typeof id !== 'string' || !UUID.test(id)) {
    return sendError(response, 400, 'INVALID_NOTE_ID', '메모 ID는 UUID여야 합니다.');
  }
  const notFound = () => sendError(response, 404, 'NOTE_NOT_FOUND', '메모를 찾을 수 없습니다.');

  if (request.method === 'GET') {
    const { data, error } = await notesTable().select('id, title, content').eq('id', id).limit(1);
    if (error) return dbFailure(response, error);
    return data.length ? response.status(200).json(toNote(data[0])) : notFound();
  }

  if (request.method === 'PUT') {
    const input = readNoteInput(request, { allowId: false });
    if (input.error) return sendError(response, 400, input.error, input.message);
    const { data, error } = await notesTable()
      .update({ title: input.title, content: input.body, updated_at: new Date().toISOString() })
      .eq('id', id).select('id, title, content');
    if (error) return dbFailure(response, error);
    return data.length ? response.status(200).json(toNote(data[0])) : notFound();
  }

  if (request.method === 'DELETE') {
    const { data, error } = await notesTable().delete().eq('id', id).select('id');
    if (error) return dbFailure(response, error);
    return data.length ? response.status(204).end() : notFound();
  }

  response.setHeader('Allow', 'GET, PUT, DELETE');
  return sendError(response, 405, 'METHOD_NOT_ALLOWED');
}
