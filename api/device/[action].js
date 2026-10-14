// GET /api/device/challenge, POST /api/device/request, POST /api/device/verify
// 로그인한 사용자의 기기 승인 요청과 확인만 다룹니다. 이 함수에는 기기를 승인으로 바꾸는 경로가 없습니다.
import { deviceChallenge, requestDevice, verifyDevice } from '../../src/device-auth.mjs';
import { requireLogin, sendError } from '../../src/notes-server.mjs';

const ACTIONS = { challenge: 'GET', request: 'POST', verify: 'POST' };

export default async function handler(request, response) {
  const action = request.query?.action;
  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action)) return sendError(response, 404, 'NOT_FOUND');
  if (request.method !== ACTIONS[action]) {
    response.setHeader('Allow', ACTIONS[action]);
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const login = await requireLogin(request, response);
  if (!login) return;
  if (action === 'challenge') return deviceChallenge(login, response);
  if (action === 'request') return requestDevice(login, request, response);
  return verifyDevice(login, request, response);
}
