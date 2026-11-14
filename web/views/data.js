// Datasets: the public Criteo sample and uploaded logs, with column mapping, validity checks and a profile.
import {$, esc, int, fix, share, go, download} from '../lib.js?v=0.26.5';
import {state, subscribe, dataset, datasetReady, inspectFile, sampleFile, addDataset, fetchPublic, removeDataset, profileOf, storage} from '../store.js?v=0.26.5';
import {EN, LOCALE, tr} from '../i18n.js?v=0.26.5';

const ROLES = EN ? [['feature', 'Covariate'], ['treatment', 'Treatment'], ['outcome', 'Outcome'], ['cost', 'Cost'], ['skip', 'Skip']] : [['feature', '공변량'], ['treatment', '처치'], ['outcome', '결과'], ['cost', '비용'], ['skip', '제외']];
const LEVELS = EN ? {ok: ['Pass', 'check-ok'], warn: ['Warning', 'check-warn'], bad: ['Error', 'check-bad']} : {ok: ['통과', 'check-ok'], warn: ['경고', 'check-warn'], bad: ['오류', 'check-bad']};
const MAX_MB = 100;

export function dataView(root, {id, query}) {
  const d = dataset(id) || state.datasets[0];
  let upload = query.get('upload') ? {stage: 'pick'} : null;
  root.innerHTML = `<section class="page data"><a class="back" href="#/">${tr('← 시뮬레이션', '← Simulation')}</a><header class="page-head row"><div><h1>${tr('데이터셋', 'Datasets')}</h1><p>${tr('처치를 무작위로 나눈 실험 로그예요. 기록된 처치와 결과를 사이클별로 나눠 replay해요.', 'Randomized experiment logs. The recorded treatments and outcomes are split into cycles and replayed.')}</p></div><button type="button" class="btn btn-primary" data-act="upload">${tr('CSV 업로드', 'Upload CSV')}</button></header>
    <div id="upload"></div><div class="data-layout"><nav class="card data-nav" id="data-nav" aria-label="${tr('데이터셋 목록', 'Datasets')}"></nav><div class="data-main" id="data-detail"></div></div>
    <input type="file" accept=".csv,text/csv,text/plain" id="file" hidden></section>`;

  function nav() {
    const groups = [[tr('공개 실험', 'Public experiments'), 'public'], [tr('업로드', 'Uploaded'), 'upload']];
    $('#data-nav', root).innerHTML = groups.map(([title, kind]) => {
      const list = state.datasets.filter(x => x.kind === kind);
      return `<h3 class="group">${title}<span>${list.length}</span></h3>${list.length ? list.map(x => `<a href="#/data/${encodeURIComponent(x.id)}" class="${x.id === d.id ? 'is-on' : ''}"><b>${esc(x.name)}</b><small>${x.kind === 'synthetic' ? tr('참값 있음', 'with truth') : x.bundled ? (EN ? `${int(x.rows)}-row sample` : `표본 ${int(x.rows)}행`) : x.stored ? `${int(x.stored.profile?.rows)}${tr('행', ' rows')}` : x.kind === 'public' ? tr('업로드 전', 'not uploaded') : ''}</small></a>`).join('') : `<p class="muted small pad">${tr('업로드한 CSV가 여기에 표시돼요.', 'CSVs you upload appear here.')}</p>`}`;
    }).join('') + (storage.persistent ? '' : `<p class="muted small pad">${tr('이 브라우저는 저장소를 쓸 수 없어 업로드한 파일이 새로고침하면 사라져요.', 'This browser has no storage, so uploaded files disappear on reload.')}</p>`);
  }
  function fields() {
    const [T, Y, C, X] = EN ? ['Treatment', 'Outcome', 'Cost', 'Covariates'] : ['처치', '결과', '비용', '공변량'];
    if (d.kind === 'synthetic') return [[T, d.treatment], [Y, d.outcome], [C, d.cost], [X, d.features.join(', ')]];
    const m = d.stored?.mapping;
    if (d.kind === 'public') return [[T, d.treatment], [Y, d.outcome], [C, d.cost], [X, (m?.features || d.mapping?.features)?.join(', ') || tr('업로드 후 표시', 'shown after upload')]];
    return [[T, m?.treatment], [Y, m?.outcome], [C, m?.cost || tr('열 없음 · 처치 1건당 1', 'no column · 1 per treatment')], [X, m?.features?.join(', ')]];
  }
  async function detail() {
    const ready = datasetReady(d), loaded = d.kind === 'synthetic' || d.stored || d.bundled;
    const tag = d.kind === 'synthetic' ? tr('합성 · 참값 있음', 'Synthetic · with truth') : d.kind === 'public' ? tr('공개 실험', 'Public experiment') : tr('업로드', 'Uploaded');
    const source = d.kind === 'public' ? `<section class="card"><div class="card-head"><div><h2>${tr('원본과 라이선스', 'Source and license')}</h2><p>${esc(d.license)}</p></div></div>
      <ul class="plain"><li>${tr('출처', 'Source')} · <a class="link" href="${esc(d.source)}" target="_blank" rel="noopener">${esc(new URL(d.source).hostname)}</a></li><li>${tr('원본 파일', 'Original file')} · <a class="link" href="${esc(d.download)}" target="_blank" rel="noopener">${esc(d.download.split('/').pop())}</a></li>${d.bundled ? `<li>${tr('표본 파일', 'Sample file')} · <a class="link" href="./${esc(d.bundled)}" download>${esc(d.bundled.split('/').pop())}</a> · <a class="link" href="https://github.com/Funbucket/upliftlab/blob/main/web/data/LICENSE-criteo.md" target="_blank" rel="noopener">${tr('뽑은 방법과 라이선스', 'How it was sampled, and the license')}</a></li>` : ''}</ul>
      ${d.stored || d.bundled ? '' : state.engine.kind === 'local' ? `<button type="button" class="btn btn-primary" data-act="fetch">${tr('원본 다운로드', 'Download the original')}</button>` : `<p class="muted small">${tr('원본 사이트가 브라우저 다운로드를 막고 있어요. 원본 파일을 받아 업로드해 주세요. 형식을 인식해 자동으로 변환해요.', 'The source site blocks browser downloads. Download the original file and upload it; the format is recognized and converted.')}</p><button type="button" class="btn btn-primary" data-act="upload">${tr('파일 업로드', 'Upload file')}</button>`}<p class="msg" id="fetch-msg"></p></section>` : '';
    $('#data-detail', root).innerHTML = `<section class="card data-head"><div class="algo-title"><h2>${esc(d.name)}</h2><span class="tag">${tag}</span></div><p class="algo-summary">${esc(d.summary || (d.stored ? (EN ? `Uploaded ${new Date(d.stored.createdAt).toLocaleDateString(LOCALE)}` : `${new Date(d.stored.createdAt).toLocaleDateString(LOCALE)} 업로드`) : ''))}</p>
      <div class="algo-actions">${ready ? `<a class="btn btn-primary" href="#/?data=${encodeURIComponent(d.id)}&amp;run=1">${tr('이 데이터로 바로 실행', 'Run with this data')}</a><a class="btn btn-quiet" href="#/?data=${encodeURIComponent(d.id)}">${tr('시뮬레이션 화면으로', 'Go to the simulation')}</a>` : ''}${d.stored && !d.bundled && d.kind !== 'synthetic' ? `<button type="button" class="btn btn-text danger" data-act="remove">${d.kind === 'upload' ? tr('삭제', 'Delete') : tr('업로드 파일 삭제', 'Delete the uploaded file')}</button>` : ''}</div>
      <dl class="defs compact">${fields().map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || '—')}</dd></div>`).join('')}</dl></section>${source}<div id="profile">${loaded ? `<section class="card"><p class="muted">${tr('요약 계산 중…', 'Summarizing…')}</p></section>` : ''}</div>`;
    if (!loaded) return;
    const profile = await profileOf(d.id).catch(() => null), box = $('#profile', root);
    if (!box) return;
    if (!profile) { box.innerHTML = `<section class="card"><p class="muted">${tr('엔진이 준비되면 요약을 표시해요.', 'The summary appears once the engine is ready.')}</p></section>`; return; }
    const p = profile, synthetic = d.kind === 'synthetic';
    const checks = !synthetic && p.checks?.length ? `<section class="card"><div class="card-head"><div><h2>${tr('데이터 검사', 'Data checks')}</h2><p>${tr('처치 배정과 비용 데이터의 타당성을 확인해요.', 'Checks that the treatment assignment and the cost data make sense.')}</p></div></div><ul class="checks">${p.checks.map(c => `<li><b>${esc(c.title)}</b><span class="${LEVELS[c.level][1]}">${LEVELS[c.level][0]}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></section>` : '';
    box.innerHTML = `${checks}<section class="card"><div class="card-head"><div><h2>${tr('요약', 'Summary')}</h2><p>${synthetic ? tr('사이클 1의 사용자 2만 명을 처치군과 대조군에 무작위 배정한 값이에요.', 'Cycle 1’s 20,000 users, randomly assigned to treatment and control.') : tr('ATE는 처치군과 대조군의 단순 평균 차이예요.', 'ATE is the plain difference of treatment and control means.')}</p></div></div>
      <dl class="kpis"><div><dt>${synthetic ? tr('사이클마다', 'Per cycle') : tr('행', 'Rows')}</dt><dd>${int(p.rows)}</dd><small>${synthetic ? tr('명', 'users') : tr('행', 'rows')}</small></div><div><dt>${tr('처치 비율', 'Treated share')}</dt><dd>${share(p.treatedShare)}</dd><small>${tr('대조군', 'control')} ${share(1 - p.treatedShare)}${p.treatments > 1 ? (EN ? ` · ${p.treatments} treatments` : ` · 처치 ${p.treatments}종류`) : ''}</small></div>
      <div><dt>${tr('처치군 결과 평균', 'Treated outcome mean')}</dt><dd>${fix(p.outcomeT, 3)}</dd><small>${tr('대조군', 'control')} ${fix(p.outcomeC, 3)} · ATE ${fix(p.ate, 3)}</small></div><div><dt>${tr('처치군 평균 비용', 'Treated mean cost')}</dt><dd>${fix(p.costT, 2)}</dd><small>${p.truth ? `${tr('참값', 'true')} τʳ ${fix(p.truth.tauR, 3)} · τᶜ ${fix(p.truth.tauC, 2)}` : `${tr('대조군', 'control')} ${fix(p.costC, 2)}`}</small></div></dl></section>
      <section class="card"><div class="card-head"><div><h2>${tr('공변량 분포', 'Covariate distributions')}</h2><p>${EN ? `${p.features.length} covariates · the model input X.` : `${p.features.length}개 · 모델 입력 X로 들어가요.`}</p></div></div><div class="hists">${p.features.map(f => `<figure><figcaption><b>${esc(f.name)}</b><span>${fix(f.min, 2)} ~ ${fix(f.max, 2)} · ${tr('평균', 'mean')} ${fix(f.mean, 2)}</span></figcaption>${hist(f)}</figure>`).join('')}</div></section>
      <section class="card"><div class="card-head"><div><h2>${tr('미리 보기', 'Preview')}</h2><p>${EN ? `First ${p.preview.rows.length} rows, after preprocessing.` : `처음 ${p.preview.rows.length}행 · 전처리 후 값이에요.`}</p></div></div><div class="table-wrap"><table class="table mono-num"><thead><tr>${p.preview.columns.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead><tbody>${p.preview.rows.map(r => `<tr>${r.map(v => `<td class="num">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function uploader() {
    const box = $('#upload', root);
    if (!upload) { box.innerHTML = ''; return; }
    const u = upload;
    if (u.stage === 'pick' || u.stage === 'reading') {
      const busy = u.stage === 'reading';
      box.innerHTML = `<section class="card drop ${busy ? 'is-busy' : ''}" id="drop"><b>${busy ? esc(u.note || tr('파일 읽는 중…', 'Reading the file…')) : tr('CSV 파일을 끌어다 놓거나 선택해 주세요', 'Drop a CSV file here, or choose one')}</b><p>${tr('처치를 무작위로 배정한 실험 로그여야 하고, 1,000행 이상이어야 해요. 열 이름은 자유예요. 올린 뒤 열마다 역할을 골라요.', 'It must be a randomized experiment log with at least 1,000 rows. Any column names work; you pick each column’s role after uploading.')}</p>
        <div class="row-actions"><button type="button" class="btn btn-primary" data-act="choose" ${busy ? 'disabled' : ''}>${tr('파일 선택', 'Choose file')}</button><button type="button" class="btn btn-quiet" data-act="sample" ${busy ? 'disabled' : ''}>${tr('예시 파일로 해 보기', 'Try the example file')}</button><button type="button" class="btn btn-text" data-act="cancel">${tr('닫기', 'Close')}</button></div>${u.error ? `<p class="error-text">${esc(u.error)}</p>` : ''}
        <div class="fmt"><div class="fmt-title"><span>${tr('파일 형식', 'File format')}</span><button type="button" class="btn-link" data-act="sample-download" ${busy ? 'disabled' : ''}>${tr('예시 파일 내려받기', 'Download the example file')}</button></div>
        <div class="table-wrap"><table class="table">${EN ? `<thead><tr><th>Example column</th><th>Role</th><th>Values</th></tr></thead><tbody>
          <tr><td class="mono">treatment</td><td><b>Treatment</b> · required</td><td>0 = control, 1 = treated (a coupon, for example). It must be assigned at random. Several treatments: 1, 2, 3…</td></tr>
          <tr><td class="mono">retained</td><td><b>Outcome</b> · required</td><td>What you want more of: conversion, purchase, retention. 0/1 or an amount</td></tr>
          <tr><td class="mono">coupon_cost</td><td><b>Cost</b> · optional</td><td>What the treatment cost, such as coupon spend. Without it every treatment costs 1</td></tr>
          <tr><td class="mono">visit_freq, days_since_last …</td><td><b>Covariates</b> · one or more</td><td>User features measured <em>before</em> treatment. Text columns become categories</td></tr>
          <tr><td class="mono">user_id</td><td>Skip</td><td>ID columns don’t go into the model</td></tr></tbody>` : `<thead><tr><th>예시 열 이름</th><th>역할</th><th>값</th></tr></thead><tbody>
          <tr><td class="mono">treatment</td><td><b>처치</b> · 필수</td><td>0 = 대조군, 1 = 처치(쿠폰 지급 등). 무작위로 정한 값이어야 해요. 처치가 여러 종류면 1, 2, 3…</td></tr>
          <tr><td class="mono">retained</td><td><b>결과</b> · 필수</td><td>전환, 구매, 리텐션처럼 늘리고 싶은 값. 0/1이나 금액</td></tr>
          <tr><td class="mono">coupon_cost</td><td><b>비용</b> · 선택</td><td>쿠폰 사용액처럼 처치로 쓴 비용. 없으면 처치 1건당 1로 계산해요</td></tr>
          <tr><td class="mono">visit_freq, days_since_last …</td><td><b>공변량</b> · 1개 이상</td><td>처치 <em>전에</em> 측정한 사용자 특성. 문자 열은 범주로 바꿔요</td></tr>
          <tr><td class="mono">user_id</td><td>제외</td><td>ID 열은 모델에 넣지 않아요</td></tr></tbody>`}</table></div></div></section>`;
      return;
    }
    const info = u.info, roleOf = name => (u.mapping.treatment === name ? 'treatment' : u.mapping.outcome === name ? 'outcome' : u.mapping.cost === name ? 'cost' : u.mapping.features.includes(name) ? 'feature' : 'skip');
    const problems = validate(u.mapping, info);
    box.innerHTML = `<section class="card mapping"><div class="card-head"><div><h2>${esc(u.file)}</h2><p>${EN ? `${int(info.rows)} rows · ${info.header.length} columns${info.rows < info.minRows ? ` · <span class="red">needs at least ${int(info.minRows)} rows</span>` : ''}` : `${int(info.rows)}행 · 열 ${info.header.length}개${info.rows < info.minRows ? ` · <span class="red">${int(info.minRows)}행 이상 필요</span>` : ''}`}</p></div><button type="button" class="btn btn-text" data-act="cancel">${tr('취소', 'Cancel')}</button></div>
      ${`<div class="role-help">${EN ? '<div><b>Treatment (T)</b>0 = control, 1–K = treatment (up to 8)</div><div><b>Outcome (Yʳ)</b>value outcome</div><div><b>Cost (Yᶜ)</b>cost outcome. Without it, 1 per treatment</div><div><b>Covariates (X)</b>model input features</div>' : '<div><b>처치 (T)</b>0 = 대조군, 1~K = 처치 (8종류까지)</div><div><b>결과 (Yʳ)</b>value outcome</div><div><b>비용 (Yᶜ)</b>cost outcome. 없으면 처치 1건당 1</div><div><b>공변량 (X)</b>모델 입력 feature</div>'}</div><label class="field narrow"><span class="field-label">${tr('이름', 'Name')}</span><input type="text" class="input" maxlength="60" value="${esc(u.name)}" data-name></label>
      <div class="table-wrap"><table class="table cols"><thead><tr><th>${tr('열', 'Column')}</th><th>${tr('값 예시', 'Examples')}</th><th>${tr('타입', 'Type')}</th><th>${tr('역할', 'Role')}</th></tr></thead><tbody>${info.columns.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="muted">${c.examples.map(esc).join(', ')}${c.distinct > 4 ? ' …' : ''}</td><td class="muted">${c.binary ? '0/1' : c.arms ? (EN ? `0–${c.arms} · ${c.arms} treatments` : `0~${c.arms} · 처치 ${c.arms}종류`) : c.numeric ? tr('숫자', 'number') : c.categorical ? tr('범주형 · one-hot 인코딩', 'categorical · one-hot encoded') : tr('문자 · 고유값 과다', 'text · too many distinct values')}${c.missing ? (EN ? ` · ${int(c.missing)} missing` : ` · 결측 ${int(c.missing)}개`) : ''}</td>
        <td><select class="input" data-col="${esc(c.name)}">${ROLES.map(([k, t]) => `<option value="${k}" ${roleOf(c.name) === k ? 'selected' : ''} ${!c.numeric && k !== 'skip' && !(k === 'feature' && c.categorical) ? 'disabled' : ''} ${k === 'treatment' && !c.arms ? 'disabled' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`}
      ${problems.length ? `<ul class="problems">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${u.error ? `<p class="error-text">${esc(u.error)}</p>` : ''}
      <div class="row-actions"><button type="button" class="btn btn-primary" data-act="add" ${problems.length || info.rows < info.minRows || u.stage === 'adding' ? 'disabled' : ''}>${u.stage === 'adding' ? tr('전처리·검사 중…', 'Preprocessing and checking…') : tr('데이터셋 추가', 'Add dataset')}</button></div></section>`;
  }
  async function read(file) {
    if (file.size > MAX_MB * 1024 * 1024) { upload = {stage: 'pick', error: EN ? `The browser takes files up to ${MAX_MB} MB. Run larger files locally (upliftlab run --data file.csv).` : `브라우저에서는 ${MAX_MB}MB까지 업로드할 수 있어요. 더 큰 파일은 로컬에서 실행해 주세요 (upliftlab run --data file.csv).`}; uploader(); return; }
    await load(() => file.text(), file.name, file.name.replace(/\.(csv|txt)$/i, ''));
  }
  // The same mapping step for a chosen file and for the example file.
  async function load(text, fileName, name, note) {
    upload = {stage: 'reading', note}; uploader();
    try {
      const csv = await text(), info = await inspectFile(csv);
      upload = {stage: 'map', file: fileName, name, text: csv, info, mapping: {...info.mapping, features: [...info.mapping.features]}};
    } catch (error) { upload = {stage: 'pick', error: error.message}; }
    uploader();
  }
  const loadSample = () => load(async () => (await sampleFile()).csv, tr('upliftlab-예시-쿠폰실험.csv', 'upliftlab-example-coupon-experiment.csv'), tr('예시 쿠폰 실험', 'Example coupon experiment'), state.engine.status === 'ready' ? tr('예시 파일 만드는 중…', 'Making the example file…') : tr('엔진을 준비한 뒤 예시 파일을 만들어요…', 'The example file is made once the engine is ready…'));
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
      t.disabled = true; $('#fetch-msg', root).textContent = tr('원본 다운로드 중…', 'Downloading the original…');
      try { await fetchPublic(d.id); } catch (error) { $('#fetch-msg', root).textContent = error.message; t.disabled = false; }
    } else if (act === 'remove' && confirm(EN ? `Delete the ‘${d.name}’ dataset? It is deleted from this browser only.` : `‘${d.name}’ 데이터셋을 삭제할까요? 이 브라우저에서만 삭제돼요.`)) { await removeDataset(d.id); if (d.kind === 'upload') go('#/data'); }
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
  if (!m.treatment) out.push(tr('처치 열을 선택해 주세요. 0 = 대조군, 1~K = 처치예요.', 'Pick the treatment column: 0 = control, 1–K = treatment.'));
  if (!m.outcome) out.push(tr('결과 열을 선택해 주세요.', 'Pick the outcome column.'));
  if (!m.features.length) out.push(tr('공변량 열을 하나 이상 선택해 주세요.', 'Pick at least one covariate column.'));
  const order = info.header.filter(h => m.features.includes(h));
  m.features.splice(0, m.features.length, ...order);
  return out;
}

function hist(f, w = 240, h = 44) {
  const max = Math.max(...f.hist, 1), bw = w / f.hist.length, step = (f.max - f.min) / f.hist.length;
  return `<svg viewBox="0 0 ${w} ${h}" class="hist" role="img" aria-label="${esc(f.name)} ${tr('분포', 'distribution')}">${f.hist.map((c, i) => `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - c / max * h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(c / max * h).toFixed(1)}" rx="1.5"><title>${fix(f.min + i * step, 2)} ~ ${fix(f.min + (i + 1) * step, 2)} · ${int(c)}</title></rect>`).join('')}</svg>`;
}
