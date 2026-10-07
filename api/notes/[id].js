// GET/PUT/DELETE /api/notes/:id
// Only the owner may read, change, or delete a note: every query is filtered by owner_id = the verified user ID.
import {
  UUID, dbFailure, notesTable, readNoteInput, refuseOwnerChange, requestsOtherOwner, requireLogin, sendError, toNote,
} from '../../src/notes-server.mjs';

export default async function handler(request, response) {
  const login = await requireLogin(request, response);
  if (!login) return;

  const id = request.query?.id;
  if (typeof id !== 'string' || !UUID.test(id)) {
    return sendError(response, 400, 'INVALID_NOTE_ID', '메모 ID는 UUID여야 합니다.');
  }
  const userId = login.userId.toLowerCase();
  const isMine = row => typeof row?.owner_id === 'string' && row.owner_id.toLowerCase() === userId;

  // Called only after an owner-filtered query matched no row: 403 if the note exists, 404 if it does not.
  const refuse = async () => {
    const { data, error } = await notesTable().select('id').eq('id', id).limit(1);
    if (error) return dbFailure(response, error);
    return data.length
      ? sendError(response, 403, 'NOT_NOTE_OWNER', '본인 메모만 읽고 고치고 지울 수 있습니다.')
      : sendError(response, 404, 'NOTE_NOT_FOUND', '메모를 찾을 수 없습니다.');
  };

  if (request.method === 'GET') {
    const { data, error } = await notesTable().select('id, title, content, owner_id')
      .eq('id', id).eq('owner_id', userId).limit(1);
    if (error) return dbFailure(response, error);
    return data.length && isMine(data[0]) ? response.status(200).json(toNote(data[0])) : refuse();
  }

  if (request.method === 'PUT') {
    if (requestsOtherOwner(request, userId)) return refuseOwnerChange(response);
    const input = readNoteInput(request, { allowId: false });
    if (input.error) return sendError(response, 400, input.error, input.message);
    const { data, error } = await notesTable()
      .update({ owner_id: userId, title: input.title, content: input.body, updated_at: new Date().toISOString() })
      .eq('id', id).eq('owner_id', userId).select('id, title, content, owner_id');
    if (error) return dbFailure(response, error);
    if (!data.length) return refuse();
    if (!isMine(data[0])) return sendError(response, 500, 'OWNER_CHECK_FAILED');
    return response.status(200).json(toNote(data[0]));
  }

  if (request.method === 'DELETE') {
    const { data, error } = await notesTable().delete()
      .eq('id', id).eq('owner_id', userId).select('id');
    if (error) return dbFailure(response, error);
    return data.length ? response.status(204).end() : refuse();
  }

  response.setHeader('Allow', 'GET, PUT, DELETE');
  return sendError(response, 405, 'METHOD_NOT_ALLOWED');
}
