// GET /api/notes: the verified user's notes. POST /api/notes: add a note owned by the verified user.
import { randomUUID } from 'node:crypto';
import { dbFailure, notesTable, readNoteInput, refuseOwnerChange, requestsOtherOwner, requireLogin, sendError, toNote }
  from '../src/notes-server.mjs';

export default async function handler(request, response) {
  const login = await requireLogin(request, response);
  if (!login) return;

  if (request.method === 'GET') {
    const { data, error } = await notesTable().select('id, title, content')
      .eq('owner_id', login.userId).order('created_at').order('seq');
    if (error) return dbFailure(response, error);
    return response.status(200).json(data.map(toNote));
  }

  if (request.method === 'POST') {
    if (requestsOtherOwner(request, login.userId)) return refuseOwnerChange(response);
    const input = readNoteInput(request, { allowId: true });
    if (input.error) return sendError(response, 400, input.error, input.message);
    const id = input.id ?? randomUUID();
    const { error } = await notesTable()
      .insert({ id, owner_id: login.userId, title: input.title, content: input.body });
    if (error?.code === '23505') return sendError(response, 409, 'NOTE_ID_TAKEN', '같은 ID의 메모가 이미 있습니다.');
    if (error) return dbFailure(response, error);
    return response.status(201).json({ id });
  }

  response.setHeader('Allow', 'GET, POST');
  return sendError(response, 405, 'METHOD_NOT_ALLOWED');
}
