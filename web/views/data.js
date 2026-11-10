// Datasets: synthetic markets, public experiments and uploaded logs, with column mapping, validity checks and a profile.
import {$, esc, int, fix, share, go, download} from '../lib.js?v=0.24.0';
import {state, subscribe, dataset, datasetReady, inspectFile, sampleFile, addDataset, fetchPublic, removeDataset, profileOf, storage} from '../store.js?v=0.24.0';

const ROLES = [['feature', '공변량'], ['treatment', '처치'], ['outcome', '결과'], ['cost', '비용'], ['skip', '제외']];
const LEVELS = {ok: ['통과', 'check-ok'], warn: ['경고', 'check-warn'], bad: ['오류', 'check-bad']};
const MAX_MB = 100;

export function dataView(root, {id, query}) {
  const d = dataset(id) || state.datasets[0];
  let upload = query.get('upload') ? {stage: 'pick'} : null;
  root.innerHTML = `<section class="page data"><a class="back" href="#/">← 시뮬레이션</a><header class="page-head row"><div><h1>데이터셋</h1><p>합성 데이터는 잠재 결과를 알아서 참값과 비교할 수 있어요. 실험 로그는 기록된 처치와 결과를 사이클별로 나눠 replay해요.</p></div><button type="button" class="btn btn-primary" data-act="upload">CSV 업로드</button></header>
    <div id="upload"></div><div class="data-layout"><nav class="card data-nav" id="data-nav" aria-label="데이터셋 목록"></nav><div class="data-main" id="data-detail"></div></div>
    <input type="file" accept=".csv,text/csv,text/plain" id="file" hidden></section>`;

  function nav() {
    const groups = [['합성', 'synthetic'], ['공개 실험', 'public'], ['업로드', 'upload']];
    $('#data-nav', root).innerHTML = groups.map(([title, kind]) => {
      const list = state.datasets.filter(x => x.kind === kind);
      return `<h3 class="group">${title}<span>${list.length}</span></h3>${list.length ? list.map(x => `<a href="#/data/${encodeURIComponent(x.id)}" class="${x.id === d.id ? 'is-on' : ''}"><b>${esc(x.name)}</b><small>${x.kind === 'synthetic' ? '참값 있음' : x.bundled ? `표본 ${int(x.rows)}행` : x.stored ? `${int(x.stored.profile?.rows)}행` : x.kind === 'public' ? '업로드 전' : ''}</small></a>`).join('') : '<p class="muted small pad">업로드한 CSV가 여기에 표시돼요.</p>'}`;
    }).join('') + (storage.persistent ? '' : '<p class="muted small pad">이 브라우저는 저장소를 쓸 수 없어 업로드한 파일이 새로고침하면 사라져요.</p>');
  }
  function fields() {
    if (d.kind === 'synthetic') return [['처치', d.treatment], ['결과', d.outcome], ['비용', d.cost], ['공변량', d.features.join(', ')]];
    const m = d.stored?.mapping;
    if (d.kind === 'public') return [['처치', d.treatment], ['결과', d.outcome], ['비용', d.cost], ['공변량', (m?.features || d.mapping?.features)?.join(', ') || '업로드 후 표시']];
    return [['처치', m?.treatment], ['결과', m?.outcome], ['비용', m?.cost || '열 없음 · 처치 1건당 1'], ['공변량', m?.features?.join(', ')]];
  }
  async function detail() {
    const ready = datasetReady(d), loaded = d.kind === 'synthetic' || d.stored || d.bundled;
    const tag = d.kind === 'synthetic' ? '합성 · 참값 있음' : d.kind === 'public' ? '공개 실험' : '업로드';
    const source = d.kind === 'public' ? `<section class="card"><div class="card-head"><div><h2>원본과 라이선스</h2><p>${esc(d.license)}</p></div></div>
      <ul class="plain"><li>출처 · <a class="link" href="${esc(d.source)}" target="_blank" rel="noopener">${esc(new URL(d.source).hostname)}</a></li><li>원본 파일 · <a class="link" href="${esc(d.download)}" target="_blank" rel="noopener">${esc(d.download.split('/').pop())}</a></li>${d.bundled ? `<li>표본 파일 · <a class="link" href="./${esc(d.bundled)}" download>${esc(d.bundled.split('/').pop())}</a> · <a class="link" href="https://github.com/Funbucket/upliftlab/blob/main/web/data/LICENSE-criteo.md" target="_blank" rel="noopener">뽑은 방법과 라이선스</a></li>` : ''}</ul>
      ${d.stored || d.bundled ? '' : state.engine.kind === 'local' ? '<button type="button" class="btn btn-primary" data-act="fetch">원본 다운로드</button>' : `<p class="muted small">원본 사이트가 브라우저 다운로드를 막고 있어요. 원본 파일을 받아 업로드해 주세요. 형식을 인식해 자동으로 변환해요.</p><button type="button" class="btn btn-primary" data-act="upload">파일 업로드</button>`}<p class="msg" id="fetch-msg"></p></section>` : '';
    $('#data-detail', root).innerHTML = `<section class="card data-head"><div class="algo-title"><h2>${esc(d.name)}</h2><span class="tag">${tag}</span></div><p class="algo-summary">${esc(d.summary || (d.stored ? `${new Date(d.stored.createdAt).toLocaleDateString('ko-KR')} 업로드` : ''))}</p>
      <div class="algo-actions">${ready ? `<a class="btn btn-primary" href="#/?data=${encodeURIComponent(d.id)}&amp;run=1">이 데이터로 바로 실행</a><a class="btn btn-quiet" href="#/?data=${encodeURIComponent(d.id)}">설정 바꾸고 실행</a>` : ''}${d.stored && !d.bundled && d.kind !== 'synthetic' ? `<button type="button" class="btn btn-text danger" data-act="remove">${d.kind === 'upload' ? '삭제' : '업로드 파일 삭제'}</button>` : ''}</div>
      <dl class="defs compact">${fields().map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl></section>${source}<div id="profile">${loaded ? '<section class="card"><p class="muted">요약 계산 중…</p></section>' : ''}</div>`;
    if (!loaded) return;
    const profile = await profileOf(d.id).catch(() => null), box = $('#profile', root);
    if (!box) return;
    if (!profile) { box.innerHTML = '<section class="card"><p class="muted">엔진이 준비되면 요약을 표시해요.</p></section>'; return; }
    const p = profile, synthetic = d.kind === 'synthetic';
    const checks = !synthetic && p.checks?.length ? `<section class="card"><div class="card-head"><div><h2>데이터 검사</h2><p>처치 배정과 비용 데이터의 타당성을 확인해요.</p></div></div><ul class="checks">${p.checks.map(c => `<li><b>${esc(c.title)}</b><span class="${LEVELS[c.level][1]}">${LEVELS[c.level][0]}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></section>` : '';
    box.innerHTML = `${checks}<section class="card"><div class="card-head"><div><h2>요약</h2><p>${synthetic ? '사이클 1의 사용자 2만 명을 처치군과 대조군에 무작위 배정한 값이에요.' : 'ATE는 처치군과 대조군의 단순 평균 차이예요.'}</p></div></div>
      <dl class="kpis"><div><dt>${synthetic ? '사이클마다' : '행'}</dt><dd>${int(p.rows)}</dd><small>${synthetic ? '명' : '행'}</small></div><div><dt>처치 비율</dt><dd>${share(p.treatedShare)}</dd><small>대조군 ${share(1 - p.treatedShare)}${p.treatments > 1 ? ` · 처치 ${p.treatments}종류` : ''}</small></div>
      <div><dt>처치군 결과 평균</dt><dd>${fix(p.outcomeT, 3)}</dd><small>대조군 ${fix(p.outcomeC, 3)} · ATE ${fix(p.ate, 3)}</small></div><div><dt>처치군 평균 비용</dt><dd>${fix(p.costT, 2)}</dd><small>${p.truth ? `참값 τʳ ${fix(p.truth.tauR, 3)} · τᶜ ${fix(p.truth.tauC, 2)}` : `대조군 ${fix(p.costC, 2)}`}</small></div></dl></section>
      <section class="card"><div class="card-head"><div><h2>공변량 분포</h2><p>${p.features.length}개 · 모델 입력 X로 들어가요.</p></div></div><div class="hists">${p.features.map(f => `<figure><figcaption><b>${esc(f.name)}</b><span>${fix(f.min, 2)} ~ ${fix(f.max, 2)} · 평균 ${fix(f.mean, 2)}</span></figcaption>${hist(f)}</figure>`).join('')}</div></section>
      <section class="card"><div class="card-head"><div><h2>미리 보기</h2><p>처음 ${p.preview.rows.length}행 · 전처리 후 값이에요.</p></div></div><div class="table-wrap"><table class="table mono-num"><thead><tr>${p.preview.columns.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>${p.preview.rows.map(r => `<tr>${r.map(v => `<td class="num">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function uploader() {
    const box = $('#upload', root);
    if (!upload) { box.innerHTML = ''; return; }
    const u = upload;
    if (u.stage === 'pick' || u.stage === 'reading') {
      const busy = u.stage === 'reading';
      box.innerHTML = `<section class="card drop ${busy ? 'is-busy' : ''}" id="drop"><b>${busy ? esc(u.note || '파일 읽는 중…') : 'CSV 파일을 끌어다 놓거나 선택해 주세요'}</b><p>처치를 무작위로 배정한 실험 로그여야 하고, 1,000행 이상이어야 해요. 열 이름은 자유예요. 올린 뒤 열마다 역할을 골라요.</p>
        <div class="row-actions"><button type="button" class="btn btn-primary" data-act="choose" ${busy ? 'disabled' : ''}>파일 선택</button><button type="button" class="btn btn-quiet" data-act="sample" ${busy ? 'disabled' : ''}>예시 파일로 해 보기</button><button type="button" class="btn btn-text" data-act="cancel">닫기</button></div>${u.error ? `<p class="error-text">${esc(u.error)}</p>` : ''}
        <div class="fmt"><div class="fmt-title"><span>파일 형식</span><button type="button" class="btn-link" data-act="sample-download" ${busy ? 'disabled' : ''}>예시 파일 내려받기</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>예시 열 이름</th><th>역할</th><th>값</th></tr></thead><tbody>
          <tr><td class="mono">treatment</td><td><b>처치</b> · 필수</td><td>0 = 대조군, 1 = 처치(쿠폰 지급 등). 무작위로 정한 값이어야 해요. 처치가 여러 종류면 1, 2, 3…</td></tr>
          <tr><td class="mono">retained</td><td><b>결과</b> · 필수</td><td>전환, 구매, 리텐션처럼 늘리고 싶은 값. 0/1이나 금액</td></tr>
          <tr><td class="mono">coupon_cost</td><td><b>비용</b> · 선택</td><td>쿠폰 사용액처럼 처치로 쓴 비용. 없으면 처치 1건당 1로 계산해요</td></tr>
          <tr><td class="mono">visit_freq, days_since_last …</td><td><b>공변량</b> · 1개 이상</td><td>처치 <em>전에</em> 측정한 사용자 특성. 문자 열은 범주로 바꿔요</td></tr>
          <tr><td class="mono">user_id</td><td>제외</td><td>ID 열은 모델에 넣지 않아요</td></tr></tbody></table></div></div></section>`;
      return;
    }
    const info = u.info, roleOf = name => (u.mapping.treatment === name ? 'treatment' : u.mapping.outcome === name ? 'outcome' : u.mapping.cost === name ? 'cost' : u.mapping.features.includes(name) ? 'feature' : 'skip');
    const problems = info.adapter ? [] : validate(u.mapping, info);
    box.innerHTML = `<section class="card mapping"><div class="card-head"><div><h2>${esc(u.file)}</h2><p>${int(info.rows)}행 · 열 ${info.header.length}개${info.rows < info.minRows ? ` · <span class="red">${int(info.minRows)}행 이상 필요</span>` : ''}</p></div><button type="button" class="btn btn-text" data-act="cancel">취소</button></div>
      ${info.adapter === 'hillstrom' ? '<p class="notice"><b>Hillstrom 이메일 실험 형식이에요</b><span>이메일 발송(남성용·여성용)을 T=1, 미발송을 T=0, visit을 결과로 쓰고, 지역·채널은 one-hot 인코딩해요. 비용 열이 없어 발송 1건당 1로 계산해요.</span></p>'
      : `<div class="role-help"><div><b>처치 (T)</b>0 = 대조군, 1~K = 처치 (8종류까지)</div><div><b>결과 (Yʳ)</b>value outcome</div><div><b>비용 (Yᶜ)</b>cost outcome. 없으면 처치 1건당 1</div><div><b>공변량 (X)</b>모델 입력 feature</div></div><label class="field narrow"><span class="field-label">이름</span><input type="text" class="input" maxlength="60" value="${esc(u.name)}" data-name></label>
      <div class="table-wrap"><table class="table cols"><thead><tr><th>열</th><th>값 예시</th><th>타입</th><th>역할</th></tr></thead><tbody>${info.columns.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="muted">${c.examples.map(esc).join(', ')}${c.distinct > 4 ? ' …' : ''}</td><td class="muted">${c.binary ? '0/1' : c.arms ? `0~${c.arms} · 처치 ${c.arms}종류` : c.numeric ? '숫자' : c.categorical ? '범주형 · one-hot 인코딩' : '문자 · 고유값 과다'}${c.missing ? ` · 결측 ${int(c.missing)}개` : ''}</td>
        <td><select class="input" data-col="${esc(c.name)}">${ROLES.map(([k, t]) => `<option value="${k}" ${roleOf(c.name) === k ? 'selected' : ''} ${!c.numeric && k !== 'skip' && !(k === 'feature' && c.categorical) ? 'disabled' : ''} ${k === 'treatment' && !c.arms ? 'disabled' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`}
      ${problems.length ? `<ul class="problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${u.error ? `<p class="error-text">${esc(u.error)}</p>` : ''}
      <div class="row-actions"><button type="button" class="btn btn-primary" data-act="add" ${problems.length || info.rows < info.minRows || u.stage === 'adding' ? 'disabled' : ''}>${u.stage === 'adding' ? '전처리·검사 중…' : '데이터셋 추가'}</button></div></section>`;
  }
  async function read(file) {
    if (file.size > MAX_MB * 1024 * 1024) { upload = {stage: 'pick', error: `브라우저에서는 ${MAX_MB}MB까지 업로드할 수 있어요. 더 큰 파일은 로컬에서 실행해 주세요 (upliftlab run --data file.csv).`}; uploader(); return; }
    await load(() => file.text(), file.name, file.name.replace(/\.(csv|txt)$/i, ''));
  }
  // The same mapping step for a chosen file and for the example file.
  async function load(text, fileName, name, note) {
    upload = {stage: 'reading', note}; uploader();
    try {
      const csv = await text(), info = await inspectFile(csv);
      upload = {stage: 'map', file: fileName, name, text: csv, info, mapping: info.adapter ? {adapter: info.adapter} : {...info.mapping, features: [...info.mapping.features]}};
    } catch (error) { upload = {stage: 'pick', error: error.message}; }
    uploader();
  }
  const loadSample = () => load(async () => (await sampleFile()).csv, 'upliftlab-예시-쿠폰실험.csv', '예시 쿠폰 실험', state.engine.status === 'ready' ? '예시 파일 만드는 중…' : '엔진을 준비한 뒤 예시 파일을 만들어요…');
  nav(); detail(); uploader();
  if (query.get('sample')) loadSample();  // from the first screen: straight to the column mapping of the example log

  const picker = $('#file', root);
  picker.addEventListener('change', () => { const f = picker.files?.[0]; picker.value = ''; if (f) read(f); });
  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'upload') { upload = {stage: 'pick'}; uploader(); picker.click(); }
    else if (act === 'choose') picker.click();
    else if (act === 'sample') await loadSample();
    else if (act === 'sample-download') { t.disabled = true; try { const file = await sampleFile(); download(file.name, file.csv, 'text/csv'); } catch (error) { upload = {stage: 'pick', error: error.message}; uploader(); } t.disabled = false; }
    else if (act === 'cancel') { upload = null; uploader(); }
    else if (act === 'add') {
      upload.stage = 'adding'; upload.error = null; uploader();
      try { const added = await addDataset({text: upload.text, name: upload.name || upload.file, mapping: upload.mapping}); upload = null; go('#/data/' + encodeURIComponent(added)); }
      catch (error) { upload.stage = 'map'; upload.error = error.message; uploader(); }
    } else if (act === 'fetch') {
      t.disabled = true; $('#fetch-msg', root).textContent = '원본 다운로드 중…';
      try { await fetchPublic(d.id); } catch (error) { $('#fetch-msg', root).textContent = error.message; t.disabled = false; }
    } else if (act === 'remove' && confirm(`‘${d.name}’ 데이터셋을 삭제할까요? 이 브라우저에서만 삭제돼요.`)) { await removeDataset(d.id); if (d.kind === 'upload') go('#/data'); }
  });
  root.addEventListener('change', e => {
    const s = e.target.closest('[data-col]'); if (!s || !upload?.mapping) return;
    const name = s.dataset.col, role = s.value, m = upload.mapping;
    for (const k of ['treatment', 'outcome', 'cost']) if (m[k] === name) m[k] = null;
    m.features = m.features.filter(f => f !== name);
    if (role === 'feature') m.features.push(name);
    else if (role !== 'skip') { if (m[role]) m.features = m.features.filter(f => f !== m[role]); m[role] = name; }
    uploader();
  });
  root.addEventListener('input', e => { if (e.target.matches('[data-name]')) upload.name = e.target.value.trim(); });
  const drop = e => { if (!e.target.closest('#drop')) return; e.preventDefault(); if (e.type === 'drop') { const f = e.dataTransfer.files?.[0]; if (f) read(f); } };
  root.addEventListener('dragover', drop); root.addEventListener('drop', drop);
  const off = subscribe(kind => { if (kind === 'datasets' || kind === 'engine') { nav(); detail(); } });
  return {destroy: off};
}

function validate(m, info) {
  const out = [];
  if (!m.treatment) out.push('처치 열을 선택해 주세요. 0 = 대조군, 1~K = 처치예요.');
  if (!m.outcome) out.push('결과 열을 선택해 주세요.');
  if (!m.features.length) out.push('공변량 열을 하나 이상 선택해 주세요.');
  const order = info.header.filter(h => m.features.includes(h));
  m.features.splice(0, m.features.length, ...order);
  return out;
}

function hist(f, w = 240, h = 44) {
  const max = Math.max(...f.hist, 1), bw = w / f.hist.length, step = (f.max - f.min) / f.hist.length;
  return `<svg viewBox="0 0 ${w} ${h}" class="hist" role="img" aria-label="${esc(f.name)} 분포">${f.hist.map((c, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - c / max * h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(c / max * h).toFixed(1)}" rx="1.5"><title>${fix(f.min + i * step, 2)} ~ ${fix(f.min + (i + 1) * step, 2)} · ${int(c)}</title></rect>`).join('')}</svg>`;
}
