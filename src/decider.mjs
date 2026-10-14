// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 규칙에 맞지 않는 요청은 기본 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'starter.deny', 'device_registered', 'step_up_required',
  'anomaly.off_hours', 'anomaly.new_network', 'anomaly.region_change', 'anomaly.activity_burst',
]);

// docs/DECIDER_REQUEST.md의 18개 이름. 브라우저 헤더 같은 다른 이름이 붙은 요청은 엔진 형식이 아닙니다.
const REQUEST_KEYS = ['schema', 'requestId', 'classId', 'projectId', 'subjectId', 'deviceId',
  'service', 'method', 'path', 'route', 'queryLength', 'querySha256', 'at', 'policyRevision',
  'deviceRegistered', 'stepUp', 'recentEvents', 'signals'];
const MAX_RECENT_EVENTS = 12;
const MAX_STEP_UP_AGE_SECONDS = 900;
const OFF_HOURS_END = 6;
const BURST_WINDOW_SECONDS = 600;
const BURST_MIN_COUNT = 10;
// 서로 다른 이상 징후가 이만큼 겹칠 때만 추가 확인을 요구합니다. 지역 급변 하나로는 막지 않습니다.
const STEP_UP_MIN_ANOMALIES = 2;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => isRecord(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const isLabel = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/u.test(value);

function readStepUp(stepUp) {
  if (!hasExactKeys(stepUp, ['verified', 'authAgeSeconds'])) return null;
  const { verified, authAgeSeconds } = stepUp;
  if (verified === false && authAgeSeconds === null) return { verified: false, authAgeSeconds: null };
  if (verified === true && Number.isFinite(authAgeSeconds)
      && authAgeSeconds >= 0 && authAgeSeconds <= MAX_STEP_UP_AGE_SECONDS) {
    return { verified: true, authAgeSeconds };
  }
  return null;
}

function readRecentEvents(events) {
  if (!Array.isArray(events) || events.length > MAX_RECENT_EVENTS) return null;
  const read = [];
  for (const event of events) {
    if (!hasExactKeys(event, ['kind', 'ageSeconds', 'count']) || !isLabel(event.kind)
        || !Number.isFinite(event.ageSeconds) || event.ageSeconds < 0
        || !Number.isInteger(event.count) || event.count < 0) return null;
    read.push({ kind: event.kind, ageSeconds: event.ageSeconds, count: event.count });
  }
  return read;
}

// 'judge_fixture'는 심판의 가상 신호이고 실제 위치 증거가 아닙니다. 그 밖의 출처는 값을 버립니다.
// 없거나 'unknown'인 값은 null로 남기고 정상값으로 채우지 않습니다.
function readSignals(signals) {
  if (!hasExactKeys(signals, ['source', 'region', 'network', 'hour']) || !isLabel(signals.source)) return null;
  const unknown = { region: null, network: null, hour: null };
  if (signals.source === 'none') return { source: 'none', ...unknown };
  if (signals.source !== 'judge_fixture') return { source: 'unverified', ...unknown };
  const label = value => (isLabel(value) && value !== 'unknown' ? value : null);
  const hour = Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null;
  return { source: 'judge_fixture', region: label(signals.region), network: label(signals.network), hour };
}

// 계약 형식을 벗어난 요청은 null입니다. 결과에는 엔진이 넘긴 값만 출처와 함께 담습니다.
export function readDecisionInput(request) {
  if (!hasExactKeys(request, REQUEST_KEYS) || request.schema !== 'aleph.decision.v1'
      || typeof request.requestId !== 'string' || !request.requestId
      || typeof request.method !== 'string' || typeof request.deviceRegistered !== 'boolean') return null;
  const stepUp = readStepUp(request.stepUp);
  const recentEvents = readRecentEvents(request.recentEvents);
  const signals = readSignals(request.signals);
  if (!stepUp || !recentEvents || !signals) return null;
  return {
    requestId: request.requestId, method: request.method,
    deviceRegistered: request.deviceRegistered, stepUp, recentEvents, signals,
  };
}

// null(없음·출처 불명)인 신호는 이상 징후로도, 정상 근거로도 세지 않습니다.
function anomalyRuleIds({ signals, recentEvents }) {
  const found = [];
  if (signals.hour !== null && signals.hour < OFF_HOURS_END) found.push('anomaly.off_hours');
  if (signals.network !== null && signals.network !== 'usual') found.push('anomaly.new_network');
  if (signals.region !== null && signals.region !== 'local') found.push('anomaly.region_change');
  const recentCount = recentEvents.filter(event => event.ageSeconds <= BURST_WINDOW_SECONDS)
    .reduce((sum, event) => sum + event.count, 0);
  if (recentCount >= BURST_MIN_COUNT) found.push('anomaly.activity_burst');
  return found;
}

const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: request?.requestId,
  decision,
  reasonCode,
  ruleIds,
});

export async function decide(request) {
  if (request?.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  }
  const input = readDecisionInput(request);
  if (!input) return respond(request, 'deny', 'starter_not_ready', ['starter.deny']);
  const anomalies = anomalyRuleIds(input);
  const needsStepUp = anomalies.length >= STEP_UP_MIN_ANOMALIES;
  if (needsStepUp && !input.stepUp.verified) {
    return respond(request, 'step_up', 'step_up_required', ['step_up_required', ...anomalies]);
  }
  if (input.method === 'GET') {
    const verified = needsStepUp ? ['step_up_required', ...anomalies] : [];
    return respond(request, 'allow', 'approved', ['device_registered', ...verified]);
  }
  return respond(request, 'deny', 'starter_not_ready', ['starter.deny']);
}
