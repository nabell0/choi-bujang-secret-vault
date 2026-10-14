// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 규칙에 맞지 않는 요청은 기본 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'starter.deny', 'device_registered', 'step_up_required',
  'anomaly.off_hours', 'anomaly.new_network', 'anomaly.region_change', 'anomaly.activity_burst',
  'suspect.network_burst',
  'zone.notes_single_item', 'zone.notices_read_only', 'zone.instructor_materials', 'zone.default_deny',
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

// 자원 ID 체계. 판정기는 엔진 요청의 service·route로, 서버는 같은 경로의 /api 주소로 같은 ID를 찾습니다.
// 반 공지·강사 자료는 구역만 정했고 아직 API·데이터가 없습니다. 강사 역할은 계약에 없어 판정 근거로 쓰지 않습니다.
const resource = (zone, service, routes) => Object.freeze({ zone, service, routes: Object.freeze(routes) });
const collectionRoutes = name => [`GET /${name}`, `POST /${name}`, `GET /${name}/:id`, `PUT /${name}/:id`,
  `PATCH /${name}/:id`, `DELETE /${name}/:id`];
export const RESOURCES = Object.freeze({
  'notes.own': resource('personal', 'notes',
    ['GET /notes', 'POST /notes', 'GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id']),
  'notices.class': resource('class', 'notices', collectionRoutes('notices')),
  'materials.instructor': resource('instructor', 'materials', collectionRoutes('materials')),
  'notices.admin': resource('admin', 'notices_admin', ['PUT /admin/notices/:id', 'DELETE /admin/notices/:id']),
  'app.auth_config': resource('public', 'auth', ['GET /auth-config']),
});

// 구역 규칙: 판정기가 허용하는 정확한 경로 모양입니다. 여기에 없는 경로는 모두 거부합니다.
// 메모 주인 비교는 자료 API(api/notes/[id].js)가 합니다. 반 공지 수정은 역할이 계약에 없어 판정기로 열지 않고,
// 서버가 강사 신원을 직접 확인하는 별도 관리 경로에서만 다룹니다.
const ZONES = Object.freeze({
  notes: Object.freeze({ ruleId: 'zone.notes_single_item', routes: Object.freeze(['GET /notes/:id']) }),
  notices: Object.freeze({ ruleId: 'zone.notices_read_only', routes: Object.freeze(['GET /notices', 'GET /notices/:id']) }),
});
// ':id' 자리에 올 수 없는 기능 이름. 자료 ID 형식은 UUID 등으로 좁히지 않습니다.
const RESERVED_ITEM_NAMES = new Set(['export', 'import', 'all', 'list', 'search', 'bulk', 'batch', 'admin',
  'download', 'backup', 'dump', 'sync', 'archive', 'count', 'new', 'edit', 'me']);
const API_PREFIX = '/api';

const findResource = match => {
  const found = Object.entries(RESOURCES).find(([, item]) => match(item));
  return found ? { id: found[0], zone: found[1].zone } : null;
};

// 엔진 요청의 service·route('GET /notes/:id' 모양)로 자원을 찾습니다. 목록에 없으면 null입니다.
export function resourceForRoute(service, route) {
  if (typeof service !== 'string' || typeof route !== 'string') return null;
  return findResource(item => item.service === service && item.routes.includes(route));
}

// 서버 함수의 메서드와 /api 경로 모양('/api/notes/:id')으로 같은 자원을 찾습니다.
export function resourceForApiRoute(method, apiPath) {
  if (typeof method !== 'string' || typeof apiPath !== 'string' || !apiPath.startsWith(`${API_PREFIX}/`)) return null;
  const route = `${method.toUpperCase()} ${apiPath.slice(API_PREFIX.length)}`;
  return findResource(item => item.routes.includes(route));
}

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
    if (!hasExactKeys(event, ['kind', 'ageSeconds', 'count'])
        || typeof event.kind !== 'string' || !event.kind || event.kind.length > 64
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

// subjectId는 엔진이 만든 가명이라 형식을 좁히지 않고, 공백·제어 문자 없는 한 덩어리인지만 봅니다.
const isPseudonym = value => typeof value === 'string' && /^[^\s\p{Cc}]{1,256}$/u.test(value);
const DEVICE_ID = /^[0-9a-f]{16}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const EMPTY_QUERY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// 계약 형식을 벗어난 요청은 null입니다. 결과에는 판정에 쓰는 공식 값만 담습니다:
// 가명 사용자(subjectId), 기기(deviceId, deviceRegistered), 요청 종류(service·method·route·path·queryLength),
// 판정 근거(stepUp·recentEvents·signals). querySha256은 queryLength와 맞는지(빈 쿼리면 빈 문자열의 해시)만 봅니다.
// classId·projectId·at·policyRevision은 엔진이 이미 확인한 값이라 이름만 확인합니다. 이 결과는 로그나 응답으로 내보내지 않습니다.
export function readDecisionInput(request) {
  if (!hasExactKeys(request, REQUEST_KEYS) || request.schema !== 'aleph.decision.v1'
      || typeof request.requestId !== 'string' || !request.requestId
      || !isPseudonym(request.subjectId)
      || typeof request.deviceId !== 'string' || !DEVICE_ID.test(request.deviceId)
      || typeof request.method !== 'string' || typeof request.deviceRegistered !== 'boolean'
      || typeof request.service !== 'string' || typeof request.route !== 'string'
      || typeof request.path !== 'string' || !request.path.startsWith('/')
      || !Number.isInteger(request.queryLength) || request.queryLength < 0
      || typeof request.querySha256 !== 'string' || !SHA256_HEX.test(request.querySha256)
      || (request.queryLength === 0) !== (request.querySha256 === EMPTY_QUERY_SHA256)) return null;
  const stepUp = readStepUp(request.stepUp);
  const recentEvents = readRecentEvents(request.recentEvents);
  const signals = readSignals(request.signals);
  if (!stepUp || !recentEvents || !signals) return null;
  return {
    requestId: request.requestId, subjectId: request.subjectId, deviceId: request.deviceId,
    method: request.method, service: request.service,
    route: request.route, path: request.path, queryLength: request.queryLength,
    resource: resourceForRoute(request.service, request.route),
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

// 평소와 다른 네트워크와 갑작스러운 다량 조회가 함께 있을 때만 의심으로 표시합니다. 지역·시각은 보지 않습니다.
function suspectRuleIds(anomalies) {
  return anomalies.includes('anomaly.new_network') && anomalies.includes('anomaly.activity_burst')
    ? ['suspect.network_burst'] : [];
}

function isItemSegment(segment) {
  let name;
  try { name = decodeURIComponent(segment); } catch { return false; }
  return name.length > 0 && name.length <= 128 && name !== '.' && name !== '..'
    && !/[\s/\\?#]/u.test(name) && !RESERVED_ITEM_NAMES.has(name.toLowerCase());
}

// 실제 path가 route의 경로 모양과 칸 수·글자까지 같아야 합니다. ':id' 칸은 자료 하나의 이름이어야 합니다.
function pathFitsRoute(path, route) {
  const shape = route.slice(route.indexOf(' ') + 1).split('/');
  const parts = path.split('/');
  return parts.length === shape.length
    && shape.every((piece, i) => (piece === ':id' ? isItemSegment(parts[i]) : piece === parts[i]));
}

// 기능은 경로로만 고릅니다. 쿼리가 붙은 요청은 어떤 구역에서도 허용하지 않습니다.
function zoneVerdict({ method, service, route, path, queryLength }) {
  const deny = (ruleId, reasonCode) => ({ allowed: false, ruleId, reasonCode });
  if (service === 'materials') return deny('zone.instructor_materials', 'instructor_zone_denied');
  if (service === 'notices' && method !== 'GET') return deny('zone.notices_read_only', 'notice_write_denied');
  const zone = Object.hasOwn(ZONES, service) ? ZONES[service] : null;
  if (!zone) return deny('zone.default_deny', 'route_not_allowed');
  if (service === 'notes' && path.split('/').length === 2) return deny(zone.ruleId, 'note_id_required');
  if (!zone.routes.includes(route) || !route.startsWith(`${method} `) || queryLength !== 0
      || !pathFitsRoute(path, route)) return deny(zone.ruleId, 'route_not_allowed');
  return { allowed: true, ruleId: zone.ruleId };
}

// 요청이 객체가 아니거나 requestId가 없어도 다섯 항목이 모두 있는 응답을 돌려줍니다.
const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: isRecord(request) && request.requestId !== undefined ? request.requestId : null,
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
  const zone = zoneVerdict(input);
  if (!zone.allowed) return respond(request, 'deny', zone.reasonCode, [zone.ruleId]);
  const anomalies = anomalyRuleIds(input);
  const suspects = suspectRuleIds(anomalies);
  const needsStepUp = suspects.length > 0 || anomalies.length >= STEP_UP_MIN_ANOMALIES;
  const reasons = ['step_up_required', ...anomalies, ...suspects];
  if (needsStepUp && !input.stepUp.verified) {
    return respond(request, 'step_up', 'step_up_required', reasons);
  }
  const verified = needsStepUp ? reasons : [];
  return respond(request, 'allow', 'approved', ['device_registered', zone.ruleId, ...verified]);
}

// decide() 응답과 따로 내는 회수 제안입니다. 제안만 하며 회수 API·DB·기기 권한은 건드리지 않습니다.
// 대상은 엔진이 확인한 등록 기기 하나(deviceId)뿐이고, 재확인을 마친 요청에는 내지 않습니다.
export function proposeRevocation(request) {
  const input = readDecisionInput(request);
  if (!input || !input.deviceRegistered || input.stepUp.verified) return { action: 'observe' };
  const suspects = suspectRuleIds(anomalyRuleIds(input));
  if (!suspects.length) return { action: 'observe' };
  return { action: 'propose_revocation', reasonCode: 'burst_read', deviceId: input.deviceId, ruleIds: suspects };
}
