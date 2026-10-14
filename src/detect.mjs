// 9단계 탐지 함수입니다. 같은 사용자의 GET 사건이 어느 10분 구간에서든 120건을 넘을 때만 회수를 제안합니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
// 제안만 돌려주고 회수 API·DB·기기 권한은 건드리지 않으며, 사건 내용을 기록하지 않습니다.
const WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120;

export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const readsBySubject = new Map();
  for (const event of events) {
    const subject = event?.identity?.sub;
    const at = typeof event?.at === 'string' ? Date.parse(event.at) : Number.NaN;
    if (event?.method !== 'GET' || typeof subject !== 'string' || !subject || !Number.isFinite(at)) continue;
    if (!readsBySubject.has(subject)) readsBySubject.set(subject, []);
    readsBySubject.get(subject).push(at);
  }
  let found = null;
  for (const [subject, times] of readsBySubject) {
    times.sort((a, b) => a - b);
    for (let start = 0, end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] >= WINDOW_MS) start += 1;
      if (end - start + 1 > BURST_LIMIT) {
        if (!found || times[end] < found.at) found = { subject, at: times[end] };
        break;
      }
    }
  }
  return found ? { action: 'propose_revocation', reasonCode: 'burst_read', subject: found.subject }
    : { action: 'observe' };
}
