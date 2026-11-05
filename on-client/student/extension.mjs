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
        root.append(detail);
      }
      return root;
    },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
