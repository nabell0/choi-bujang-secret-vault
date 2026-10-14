// POST /api/restore/notes/:id
// Restores one note from the private backup (public.notes_backup) after checking the backup's ID, owner, and content hash.
// Only the verified owner may restore. Other notes and the backup are never changed; audit rows are only added.
// The owner comes from the verified login alone; the request body, headers, and query are not read.
import {
  UUID, dbFailure, noteBackupTable, noteContentSha256, notesTable, requireLogin, restoreAuditTable, sendError,
} from '../../../src/notes-server.mjs';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const login = await requireLogin(request, response);
  if (!login) return;

  const id = typeof request.query?.id === 'string' ? request.query.id.toLowerCase() : '';
  if (!UUID.test(id)) return sendError(response, 400, 'INVALID_NOTE_ID', '메모 ID는 UUID여야 합니다.');
  const userId = login.userId.toLowerCase();
  const audit = async (result, contentSha256 = null) => {
    const { error } = await restoreAuditTable()
      .insert({ note_id: id, actor_id: userId, result, content_sha256: contentSha256 });
    if (error) console.error('restore audit failed', error.code ?? 'unknown');
    return !error;
  };

  const { data: copies, error: copyError } = await noteBackupTable()
    .select('id, owner_id, title, content, content_sha256').eq('id', id).limit(1);
  if (copyError) return dbFailure(response, copyError, 'RESTORE_UNAVAILABLE');
  const copy = copies[0];
  if (!copy) {
    await audit('no_backup');
    return sendError(response, 404, 'BACKUP_NOT_FOUND', '이 메모의 사본이 없습니다.');
  }
  if (String(copy.owner_id).toLowerCase() !== userId) {
    await audit('denied_not_owner');
    return sendError(response, 403, 'NOT_NOTE_OWNER', '본인 메모만 복원할 수 있습니다.');
  }
  if (String(copy.id).toLowerCase() !== id || typeof copy.title !== 'string' || typeof copy.content !== 'string'
      || noteContentSha256(copy.title, copy.content) !== copy.content_sha256) {
    await audit('backup_verify_failed');
    return sendError(response, 409, 'BACKUP_VERIFY_FAILED', '사본 검증에 실패해 복원하지 않았습니다.');
  }

  const { data: rows, error: writeError } = await notesTable()
    .upsert({ id, owner_id: userId, title: copy.title, content: copy.content, updated_at: new Date().toISOString() },
      { onConflict: 'id' })
    .select('id, owner_id, title, content');
  if (writeError) return dbFailure(response, writeError, 'RESTORE_UNAVAILABLE');
  const row = rows?.[0];
  const restoredSha256 = row ? noteContentSha256(row.title, row.content) : null;
  if (!row || String(row.id).toLowerCase() !== id || String(row.owner_id).toLowerCase() !== userId
      || restoredSha256 !== copy.content_sha256) {
    await audit('restore_verify_failed', restoredSha256);
    return sendError(response, 500, 'RESTORE_VERIFY_FAILED');
  }
  if (!await audit('restored', restoredSha256)) {
    return sendError(response, 502, 'RESTORE_AUDIT_FAILED', '메모는 복원했지만 감사 기록을 남기지 못했습니다.');
  }
  return response.status(200).json({ id, restored: true, contentSha256: restoredSha256 });
}
