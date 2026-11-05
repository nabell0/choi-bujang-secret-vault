// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
export function createStudentView({ onChange } = {}) {
  const eventFilters = { kind: 'all', app: 'all', access: 'all' };
  let selectedEventId = null;
  let eventsSeenKey = '';
  return {
    renderIdentity(input) {
      const deviceStatusText = (status) => {
        if (status === 'compliant') return '보안 기준 충족 (compliant)';
        if (status === 'noncompliant') return '보안 기준 미충족 (noncompliant)';
        if (status === 'unknown') return '확인 불가 (unknown)';
        return '확인 불가';
      };
      const sessionStatusText = (status) => {
        if (status === 'active') return '활성 (active)';
        if (status === 'expired') return '만료 (expired)';
        if (status === 'revoked') return '철회됨 (revoked)';
        if (status === 'unknown') return '확인 불가 (unknown)';
        return '확인 불가';
      };
      const modeText = (mode) => {
        if (mode === 'demo') return '예제 자료';
        if (mode === 'disconnected') return '연결 없음';
        if (mode === 'unknown') return '확인 불가';
        return '';
      };
      const shown = (value) => (typeof value === 'string' && value.length > 0 ? value : '확인 불가');
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const addMode = (parent, resource) => {
        const text = modeText(resource && resource.mode);
        if (text) add(parent, 'p', text);
      };
      const section = (title, resource, fillOk) => {
        const box = document.createElement('section');
        add(box, 'h3', title);
        const current = resource && typeof resource === 'object' ? resource : { status: 'error' };
        addMode(box, current);
        if (current.status === 'loading') {
          add(box, 'p', '불러오는 중');
          return box;
        }
        if (current.status === 'error') {
          const code = current.error && current.error.code;
          const unverified = code === 'CONTRACT_MISMATCH' || code === 'ENGINE_RESULT_UNVERIFIED';
          const message = current.error && typeof current.error.message === 'string' ? current.error.message : '';
          const lead = unverified ? '확인 불가' : '연결 실패';
          add(box, 'p', message ? `${lead}: ${message}` : lead);
          return box;
        }
        if (current.status === 'ok') {
          fillOk(box, current.data);
          return box;
        }
        add(box, 'p', '확인 불가');
        return box;
      };

      const root = document.createElement('div');
      root.append(section('현재 계정', input && input.me, (box, data) => {
        const user = data && data.user;
        const device = data && data.device;
        const session = data && data.session;
        if (!user || !device || !session) {
          add(box, 'p', '확인 불가');
          return;
        }
        const list = document.createElement('dl');
        add(list, 'dt', '사용자');
        add(list, 'dd', `${shown(user.label)} · ${shown(user.id)}`);
        add(list, 'dt', '기기');
        add(list, 'dd', `${shown(device.label)} · ${shown(device.id)} · ${deviceStatusText(device.status)}`);
        add(list, 'dt', '세션');
        add(list, 'dd', `${shown(session.id)} · ${sessionStatusText(session.status)}`);
        box.append(list);
      }));
      root.append(section('기기', input && input.devices, (box, data) => {
        if (!Array.isArray(data)) {
          add(box, 'p', '확인 불가');
          return;
        }
        if (data.length === 0) {
          add(box, 'p', '표시할 기기가 없습니다.');
          return;
        }
        const list = document.createElement('ul');
        for (const device of data) {
          add(list, 'li', device && typeof device === 'object'
            ? `${shown(device.label)} · ${shown(device.id)} · ${deviceStatusText(device.status)}`
            : '확인 불가');
        }
        box.append(list);
      }));
      root.append(section('세션', input && input.sessions, (box, data) => {
        if (!Array.isArray(data)) {
          add(box, 'p', '확인 불가');
          return;
        }
        if (data.length === 0) {
          add(box, 'p', '표시할 세션이 없습니다.');
          return;
        }
        const list = document.createElement('ul');
        for (const session of data) {
          add(list, 'li', session && typeof session === 'object'
            ? `${shown(session.id)} · ${sessionStatusText(session.status)}`
            : '확인 불가');
        }
        box.append(list);
      }));
      return root;
    },
    renderDecision(input) {
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const source = input && typeof input === 'object' ? input : { status: 'idle' };
      const appId = typeof source.appId === 'string' && source.appId.length > 0 ? source.appId : '';
      const root = document.createElement('div');
      if (appId) add(root, 'p', `업무 앱: ${appId}`);
      if (source.status === 'idle') {
        add(root, 'p', '앱을 골라 접속을 요청하세요.');
        return root;
      }
      if (source.status === 'loading') {
        add(root, 'p', '판정 확인 중');
        return root;
      }
      if (source.status === 'error') {
        const message = source.error && typeof source.error.message === 'string' ? source.error.message : '';
        add(root, 'p', message ? `요청 실패: ${message}` : '요청 실패');
        add(root, 'p', '거부(deny) 판정이 아닙니다.');
        return root;
      }
      if (source.status !== 'ok' || !source.data || typeof source.data !== 'object') {
        add(root, 'p', '확인 불가(unknown)');
        add(root, 'p', '허용되지 않았습니다.');
        return root;
      }
      const data = source.data;
      const labels = {
        allow: '허용(allow)',
        deny: '거부(deny)',
        challenge: '추가 확인 필요(challenge)',
        unknown: '확인 불가(unknown)',
      };
      const decision = typeof data.decision === 'string' ? data.decision : '';
      add(root, 'p', Object.hasOwn(labels, decision) ? labels[decision] : '확인 불가(unknown)');
      if (decision === 'allow') add(root, 'p', '정책상 접근 허용입니다. 실제 앱 접속 성공은 보장하지 않습니다.');
      else if (decision === 'deny') add(root, 'p', '접근이 거부되었습니다.');
      else if (decision === 'challenge') add(root, 'p', '이 앱은 추가 확인 절차를 대신 수행하지 않습니다.');
      else add(root, 'p', '허용되지 않았습니다.');
      const list = document.createElement('dl');
      add(list, 'dt', '판정 이유');
      add(list, 'dd', typeof data.reason === 'string' && data.reason.length > 0 ? data.reason : '확인 불가');
      add(list, 'dt', '판정 시각');
      add(list, 'dd', typeof data.checkedAt === 'string' && data.checkedAt.length > 0 ? data.checkedAt : '확인 불가');
      root.append(list);
      return root;
    },
    renderEvents(input) {
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const shown = (value) => (typeof value === 'string' && value.length > 0 ? value : '확인 불가');
      const kindText = (kind) => {
        if (kind === 'access') return '접속 기록(access)';
        if (kind === 'xdr') return 'XDR 경보(xdr)';
        return '확인 불가';
      };
      const accessText = (status) => {
        if (status === 'allowed') return '허용됨(allowed)';
        if (status === 'denied') return '거부됨(denied)';
        return '확인 불가(unknown)';
      };
      const sessionText = (status) => {
        if (status === 'active') return '활성(active)';
        if (status === 'expired') return '만료(expired)';
        if (status === 'revoked') return '철회됨(revoked)';
        return '확인 불가(unknown)';
      };
      const deviceText = (status) => {
        if (status === 'compliant') return '보안 기준 충족(compliant)';
        if (status === 'noncompliant') return '보안 기준 미충족(noncompliant)';
        return '확인 불가(unknown)';
      };
      const source = input && typeof input === 'object' ? input : { status: 'error' };
      const seenKey = source.status !== 'ok' || !Array.isArray(source.data)
        ? `${source.status}|${source.error && source.error.code}|${source.error && source.error.message}`
        : `ok|${source.data.map((event) => (event && typeof event === 'object' ? `${event.id}\t${event.at}` : '')).join('\n')}`;
      if (seenKey !== eventsSeenKey) {
        eventsSeenKey = seenKey;
        selectedEventId = null;
        eventFilters.kind = 'all';
        eventFilters.app = 'all';
        eventFilters.access = 'all';
      }
      const root = document.createElement('div');
      if (source.status === 'loading') {
        add(root, 'p', '불러오는 중');
        return root;
      }
      if (source.status === 'error') {
        const code = source.error && source.error.code;
        if (code === 'CONTRACT_MISMATCH' || code === 'ENGINE_RESULT_UNVERIFIED') add(root, 'p', '확인 불가');
        const message = source.error && typeof source.error.message === 'string' ? source.error.message : '';
        add(root, 'p', message ? `기록을 불러오지 못했습니다: ${message}` : '기록을 불러오지 못했습니다');
        return root;
      }
      if (source.status !== 'ok' || !Array.isArray(source.data)) {
        add(root, 'p', '확인 불가');
        return root;
      }
      const events = source.data.slice().sort((left, right) => {
        const leftAt = Date.parse(left && left.at);
        const rightAt = Date.parse(right && right.at);
        const leftOk = Number.isFinite(leftAt);
        const rightOk = Number.isFinite(rightAt);
        if (leftOk && rightOk && leftAt !== rightAt) return rightAt - leftAt;
        if (leftOk !== rightOk) return leftOk ? -1 : 1;
        return String(right && right.at).localeCompare(String(left && left.at));
      });
      const unique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
      const addFilter = (title, key, values) => {
        const label = document.createElement('label');
        label.textContent = title;
        const select = document.createElement('select');
        select.setAttribute('aria-label', title);
        const options = ['all', ...values];
        for (const value of options) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          select.append(option);
        }
        select.value = options.includes(eventFilters[key]) ? eventFilters[key] : 'all';
        select.addEventListener('change', () => {
          eventFilters[key] = select.value;
          if (typeof onChange === 'function') onChange();
        });
        label.append(select);
        root.append(label);
      };
      addFilter('기록 종류', 'kind', unique(events.map((event) => event && event.kind)));
      addFilter('업무 앱', 'app', unique(events.map((event) => event && event.appId)));
      addFilter('접속 상태', 'access', unique(events.map((event) => event && event.state && event.state.access)));
      const filtered = events.filter((event) => event && typeof event === 'object'
        && (eventFilters.kind === 'all' || event.kind === eventFilters.kind)
        && (eventFilters.app === 'all' || event.appId === eventFilters.app)
        && (eventFilters.access === 'all' || (event.state && event.state.access === eventFilters.access)));
      if (events.length === 0) {
        add(root, 'p', '표시할 기록이 없습니다');
        return root;
      }
      if (filtered.length === 0) add(root, 'p', '선택한 조건에 맞는 기록이 없습니다.');
      const list = document.createElement('ul');
      let selected = null;
      for (const event of filtered) {
        const row = document.createElement('li');
        if (typeof event.id === 'string' && event.id.length > 0) row.setAttribute('data-student-event-id', event.id);
        add(row, 'p', `사건 ID: ${shown(event.id)}`);
        add(row, 'p', `시각: ${shown(event.at)}`);
        add(row, 'p', `종류: ${kindText(event.kind)}`);
        add(row, 'p', `앱: ${typeof event.appId === 'string' && event.appId.length > 0 ? event.appId : '앱을 확인할 수 없습니다'}`);
        add(row, 'p', `요약: ${shown(event.summary)}`);
        if (typeof event.id === 'string' && event.id.length > 0) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `${event.id} 상세`;
          button.addEventListener('click', () => {
            selectedEventId = event.id;
            if (typeof onChange === 'function') onChange();
          });
          row.append(button);
          if (selectedEventId === event.id) selected = event;
        }
        list.append(row);
      }
      root.append(list);
      if (selected) {
        const detail = document.createElement('section');
        detail.setAttribute('data-student-event-detail', selected.id);
        add(detail, 'h3', '기록 상세');
        add(detail, 'p', `사건 ID: ${shown(selected.id)}`);
        add(detail, 'p', `앱: ${typeof selected.appId === 'string' && selected.appId.length > 0 ? selected.appId : '앱을 확인할 수 없습니다'}`);
        add(detail, 'h3', '근거');
        const evidence = Array.isArray(selected.evidence) ? selected.evidence : [];
        if (evidence.length === 0) add(detail, 'p', '근거 없음');
        for (const item of evidence) {
          add(detail, 'p', item && typeof item === 'object' ? `${shown(item.id)} · ${shown(item.text)}` : '확인 불가');
        }
        add(detail, 'h3', '규칙');
        const rules = Array.isArray(selected.rules) ? selected.rules : [];
        if (rules.length === 0) add(detail, 'p', '규칙 없음');
        for (const item of rules) {
          add(detail, 'p', item && typeof item === 'object' ? `${shown(item.id)} · ${shown(item.text)}` : '확인 불가');
        }
        const state = selected.state && typeof selected.state === 'object' ? selected.state : {};
        add(detail, 'h3', '상태');
        add(detail, 'p', `접속: ${accessText(state.access)}`);
        add(detail, 'p', `세션: ${sessionText(state.session)}`);
        add(detail, 'p', `기기: ${deviceText(state.device)}`);
        const actions = Array.isArray(selected.supportedActions) ? selected.supportedActions : [];
        for (const action of actions) {
          if (typeof action !== 'string' || action.length === 0) continue;
          const unsupported = document.createElement('button');
          unsupported.type = 'button';
          unsupported.disabled = true;
          unsupported.textContent = `${action} 미지원`;
          detail.append(unsupported);
          add(detail, 'p', '아직 지원하지 않습니다. 조치 실행 연결은 준비 중입니다. 요청을 보내지 않습니다.');
        }
        root.append(detail);
      }
      return root;
    },
    renderStatus(input) {
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const secret = /(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.|api[_ -]?key|password|비밀번호|토큰\s*[:=])/i;
      const safeText = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 200 && !secret.test(value) ? value : '확인 불가');
      const deviceStatusText = (status) => {
        if (status === 'compliant') return '보안 기준 충족(compliant)';
        if (status === 'noncompliant') return '보안 기준 미충족(noncompliant)';
        return '확인 불가(unknown)';
      };
      const sessionStatusText = (status) => {
        if (status === 'active') return '활성(active)';
        if (status === 'expired') return '만료(expired)';
        if (status === 'revoked') return '철회됨(revoked)';
        return '확인 불가(unknown)';
      };
      const source = input && typeof input === 'object' ? input : {};
      const timedOut = (resource) => resource && resource.error && (resource.error.code === 'TIMEOUT' || (typeof resource.error.message === 'string' && resource.error.message.includes('시간 초과')));
      const failureText = (resource, name) => {
        const message = resource && resource.error && typeof resource.error.message === 'string' ? resource.error.message : '';
        const lead = timedOut(resource) ? `시간 초과. ${name} 불러오지 못했습니다` : `${name} 불러오지 못했습니다`;
        return message ? `${lead}: ${safeText(message) === '확인 불가' ? '확인 불가' : message}` : lead;
      };
      const retry = (parent) => {
        add(parent, 'p', '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요. 자동으로 다시 요청하지 않습니다.');
      };
      const root = document.createElement('div');
      const devicesBox = document.createElement('section');
      add(devicesBox, 'h3', '기기');
      const devices = source.devices;
      if (!devices || devices.status === 'loading') add(devicesBox, 'p', '불러오는 중');
      else if (devices.status === 'error') {
        add(devicesBox, 'p', failureText(devices, '기기를'));
        retry(devicesBox);
      } else if (devices.status === 'ok' && Array.isArray(devices.data) && devices.data.length === 0) add(devicesBox, 'p', '등록된 기기가 없습니다.');
      else if (devices.status === 'ok' && Array.isArray(devices.data)) {
        const list = document.createElement('ul');
        for (const device of devices.data) {
          add(list, 'li', device && typeof device === 'object' ? `${safeText(device.label)} · ${deviceStatusText(device.status)}` : '확인 불가');
        }
        devicesBox.append(list);
      } else add(devicesBox, 'p', '확인 불가');
      root.append(devicesBox);

      const sessionsBox = document.createElement('section');
      add(sessionsBox, 'h3', '세션');
      add(sessionsBox, 'p', '세션은 지금 검증된 연결 하나만 표시합니다. 지난 세션 목록이 아닙니다.');
      const sessions = source.sessions;
      if (!sessions || sessions.status === 'loading') add(sessionsBox, 'p', '불러오는 중');
      else if (sessions.status === 'error') {
        add(sessionsBox, 'p', failureText(sessions, '세션을'));
        retry(sessionsBox);
      } else if (sessions.status === 'ok' && Array.isArray(sessions.data) && sessions.data.length === 0) add(sessionsBox, 'p', '현재 연결 없음');
      else if (sessions.status === 'ok' && Array.isArray(sessions.data)) {
        const list = document.createElement('ul');
        for (const session of sessions.data) {
          add(list, 'li', session && typeof session === 'object' ? `${safeText(session.id)} · ${sessionStatusText(session.status)}` : '확인 불가');
        }
        sessionsBox.append(list);
      } else add(sessionsBox, 'p', '확인 불가');
      root.append(sessionsBox);

      const notices = document.createElement('section');
      add(notices, 'h3', '알림');
      const notifications = Array.isArray(source.notifications) ? source.notifications : [];
      if (notifications.length === 0) add(notices, 'p', '주의할 알림이 없습니다');
      else {
        const list = document.createElement('ul');
        for (const item of notifications) {
          if (!item || typeof item !== 'object') {
            add(list, 'li', '확인 불가');
            continue;
          }
          add(list, 'li', `자료: ${safeText(item.resource)} · code: ${safeText(item.code)} · ${safeText(item.message)}`);
        }
        notices.append(list);
      }
      root.append(notices);

      const help = document.createElement('section');
      add(help, 'h3', '도움정보');
      add(help, 'p', '이 값은 도움 요청에 쓰도록 복사하는 정보입니다. API 키나 인증 토큰은 포함하지 않습니다.');
      const diagnostics = source.diagnostics;
      let copyText = '';
      if (!diagnostics || diagnostics.status === 'idle') add(help, 'p', '도움정보를 아직 불러오지 않았습니다.');
      else if (diagnostics.status === 'loading') add(help, 'p', '불러오는 중');
      else if (diagnostics.status === 'error') {
        add(help, 'p', failureText(diagnostics, '도움정보를'));
        retry(help);
      } else if (diagnostics.status === 'ok' && diagnostics.data && typeof diagnostics.data === 'object') {
        const engine = diagnostics.data.engine && typeof diagnostics.data.engine === 'object' ? diagnostics.data.engine : {};
        const lines = [
          `requestId: ${safeText(diagnostics.data.requestId)}`,
          `component: ${safeText(diagnostics.data.component)}`,
          `version: ${safeText(diagnostics.data.version)}`,
          `checkedAt: ${safeText(diagnostics.data.checkedAt)}`,
          `engine.mode: ${safeText(engine.mode)}`,
          `engine.code: ${safeText(engine.code)}`,
        ];
        for (const line of lines) add(help, 'p', line);
        copyText = lines.join('\n');
      } else add(help, 'p', '확인 불가');
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.textContent = '도움정보 복사';
      const copyStatus = add(help, 'p', '도움정보 복사는 이 버튼을 눌렀을 때만 실행됩니다.');
      copyButton.addEventListener('click', async () => {
        if (!copyText) {
          copyStatus.textContent = '복사할 도움정보가 없습니다.';
          return;
        }
        try {
          await navigator.clipboard.writeText(copyText);
          copyStatus.textContent = '도움 요청에 쓸 안전한 값을 복사했습니다.';
        } catch {
          copyStatus.textContent = '자동 복사를 사용할 수 없습니다. 화면에 표시된 값을 선택해 복사하세요.';
        }
      });
      help.append(copyButton);
      root.append(help);
      return root;
    },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection(input) {
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const secret = /(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.|api[_ -]?key|password|비밀번호|토큰|열쇠)/i;
      const safeText = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 500 && !secret.test(value) ? value : '');
      const safeCode = (value) => (typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : '확인 불가');
      const guidance = (code) => {
        if (['ON_AI_PROVISIONING_PENDING', 'ON_AI_AUTHORIZATION_CHANGED'].includes(code)) return '권한 준비 중입니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요. 학생 코드의 잘못이 아닙니다.';
        if (['AI_REQUEST_UNVERIFIED', 'SUBJECT_SCOPE_UNVERIFIED', 'ON_AI_INVALID_INPUT', 'ON_AI_INVALID_OUTPUT'].includes(code)) return '확인 불가입니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.';
        if (code === 'WB_CLCO_AUTH_REQUIRED') return '인증 실패입니다. 계정 연결을 다시 확인하고 담당자에게 확인을 요청하세요.';
        if (code === 'WB_CLCO_ACCESS_BLOCKED') return '접근 제한입니다. 계정 연결을 다시 확인하고 담당자에게 확인을 요청하세요.';
        if (code === 'WB_CLCO_COHORT_BUDGET_EXHAUSTED') return `${code}는 반 사용량 문제입니다. 사용량·한도·제한·시간 문제 가운데 사용량이 소진됐습니다. 담당자에게 확인을 요청하세요.`;
        if (code === 'WB_CLCO_LIMIT_REACHED') return `${code}는 이용 한도 문제입니다. 사용량·한도·제한·시간 문제 가운데 이용 한도에 도달했습니다. 담당자에게 확인을 요청하세요.`;
        if (code === 'WB_CLCO_RATE_LIMITED') return `${code}는 요청 제한 문제입니다. 사용량·한도·제한·시간 문제 가운데 요청이 제한됐습니다. 잠시 뒤 직접 다시 점검하세요.`;
        if (code === 'WB_CLCO_INVALID_LIMIT') return `${code}는 요청 제한 시간 문제입니다. 사용량·한도·제한·시간 문제 가운데 요청 제한 시간을 확인하세요.`;
        if (code === 'WB_CLCO_SESSION_CLOSED') return `${code}는 이용 시간 문제입니다. 사용량·한도·제한·시간 문제 가운데 이용 시간이 아닙니다. 이용 시간을 확인하세요.`;
        if (['WB_CLCO_TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT', 'TIMEOUT'].includes(code)) return '시간 초과입니다. 잠시 뒤 현재 API 연결 점검 버튼을 직접 눌러 다시 점검하세요.';
        if (code === 'NETWORK_ERROR' || code === 'WB_CLCO_NETWORK_ERROR') return '네트워크 연결 문제입니다. 잠시 뒤 직접 다시 점검하세요.';
        if (['WB_CLCO_CANCELLED', 'CANCELLED', 'REQUEST_CANCELLED'].includes(code)) return '취소됨. 이전 결과는 현재 결과가 아닙니다.';
        if (['ON_AI_MODEL_LIST_EMPTY', 'MODEL_NOT_CONFIGURED'].includes(code)) return '쓸 수 있는 모델이 없습니다. 담당자에게 모델 허용 설정 확인을 요청하세요.';
        return '확인 불가입니다. 연결 점검이 끝난 것이 아닙니다.';
      };
      const manual = (parent) => add(parent, 'p', '다시 점검은 현재 API 연결 점검 버튼을 직접 누르세요. 자동으로 다시 점검하지 않습니다.');
      const source = input && typeof input === 'object' ? input : { status: 'idle' };
      const root = document.createElement('div');
      if (source.status === 'idle') {
        add(root, 'p', 'AI 연결 점검 전');
        manual(root);
        return root;
      }
      if (source.status === 'loading') {
        add(root, 'p', 'AI 연결 점검 중');
        return root;
      }
      if (source.status === 'error') {
        const code = safeCode(source.error && source.error.code);
        add(root, 'p', `code: ${code}`);
        add(root, 'p', guidance(code === '확인 불가' ? '' : code));
        const message = safeText(source.error && source.error.message);
        if (message) add(root, 'p', `message: ${message}`);
        manual(root);
        return root;
      }
      const data = source.data;
      const checkedAt = safeText(source.checkedAt);
      if (source.status === 'ok' && data && data.transportChecked === true && (data.audienceAuthorization === 'test' || data.audienceAuthorization === 'verified') && Number.isInteger(data.modelCount) && data.modelCount >= 0 && data.modelCount <= 10000) {
        add(root, 'p', data.audienceAuthorization === 'test' ? '시험 연결 점검(test)' : '앱 권한 확인 후 점검(verified)');
        add(root, 'p', `응답 모델 수: ${data.modelCount}`);
        add(root, 'p', `점검 시각: ${checkedAt || '확인 불가'}`);
        add(root, 'p', '연결만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다.');
        return root;
      }
      add(root, 'p', '확인 불가입니다. 연결 점검이 끝난 것이 아닙니다.');
      return root;
    },
    renderExplanation(input) {
      const add = (parent, tag, text) => {
        const node = document.createElement(tag);
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const secret = /(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{8,}\.|api[_ -]?key|password|비밀번호|토큰|열쇠)/i;
      const safeText = (value) => (typeof value === 'string' && value.length > 0 && value.length <= 1500 && !secret.test(value) ? value : '');
      const safeCode = (value) => (typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : '확인 불가');
      const safeId = (value) => (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !secret.test(value) ? value : '');
      const source = input && typeof input === 'object' ? input : {};
      const explanation = source.explanation && typeof source.explanation === 'object' ? source.explanation : { status: 'idle' };
      const root = document.createElement('div');
      const eventId = safeId(source.event && source.event.id);
      const summary = explanation.status === 'ok' && explanation.data ? safeText(explanation.data.summary) : '';
      if (explanation.status === 'ok' && eventId && summary) {
        root.setAttribute('data-student-explanation-event', eventId);
        add(root, 'p', `사건 ID: ${eventId}`);
        add(root, 'p', `요약: ${summary}`);
        return root;
      }
      if (explanation.status === 'error') {
        const code = safeCode(explanation.error && explanation.error.code);
        add(root, 'p', `code: ${code}`);
        const message = safeText(explanation.error && explanation.error.message);
        add(root, 'p', message ? `message: ${message}` : '사건 설명을 표시할 수 없습니다.');
        add(root, 'p', '기록은 그대로입니다.');
        return root;
      }
      if (explanation.status === 'loading') {
        add(root, 'p', '사건 설명 요청 중');
        return root;
      }
      add(root, 'p', '사건 설명을 아직 요청하지 않았습니다.');
      return root;
    },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
