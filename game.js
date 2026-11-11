import {normalize, invalidReason} from './geometry.js';

export const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
export const verdict = result => result.status === 'correct' ? '正解！' : result.status === 'incorrect' ? '不正解' : '判定できませんでした';

export function publicShareUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const privateHost = !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal') || host.includes(':') ||
      /^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
    if (url.protocol !== 'https:' || privateHost || url.username || url.password || url.search || url.hash) return '';
    return url.href;
  } catch { return ''; }
}

export function shareLink(prefecture, result, configuredUrl = '') {
  if (!result || !['correct', 'incorrect'].includes(result.status)) return null;
  const lines = ['記憶だけで都道府県', `お題：${prefecture.name}｜${verdict(result)}`];
  const metrics = [];
  if (Number.isFinite(result.iou)) metrics.push(`重なり率：${percent(result.iou)}`);
  if (Number.isFinite(result.distance95)) metrics.push(`輪郭ずれ：${percent(result.distance95)}`);
  if (metrics.length) lines.push(metrics.join('｜'));
  lines.push('#記憶だけで都道府県');
  const intent = new URL('https://x.com/intent/tweet');
  intent.searchParams.set('text', lines.join('\n'));
  const url = publicShareUrl(configuredUrl);
  if (url) intent.searchParams.set('url', url);
  return intent.href;
}

export function validateDataset(data) {
  if (data?.schemaVersion !== 1 || typeof data.datasetVersion !== 'string' ||
      !data.source?.url || !Array.isArray(data.prefectures) || data.prefectures.length !== 47) {
    throw new Error('正解データの形式が違います');
  }
  const codes = new Set();
  for (const item of data.prefectures) {
    if (!/^([0-3][1-9]|[1-4]0|4[1-7])$/.test(item.code) || codes.has(item.code) ||
        typeof item.name !== 'string' || !item.name || invalidReason(normalize(item.outline))) {
      throw new Error('47都道府県の輪郭を確認できません');
    }
    codes.add(item.code);
  }
  return data;
}

import {createResultImage, drawComparison} from './result-image.js';

export const DRAWING_MS = 15000;
export const INK_SIZE = 512;

export function paintStrokes(canvas, strokes) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width, 0, 0, canvas.height, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#e75b35'; ctx.fillStyle = '#e75b35'; ctx.lineWidth = stroke.width;
    if (stroke.points.length === 1) {
      ctx.beginPath(); ctx.arc(...stroke.points[0], stroke.width / 2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(...stroke.points[0]);
      for (const point of stroke.points.slice(1)) ctx.lineTo(...point);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function inkMask(canvas) {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] >= 128 ? 1 : 0;
  return mask;
}

export class Round {
  constructor({now = () => performance.now(), wall = () => Date.now(), random = Math.random, onFinish = () => {}} = {}) {
    Object.assign(this, {now, wall, random, onFinish, roundId: 0, phase: 'ready',
      strokes: [], result: null, pointerId: null, tool: 'pen', currentStroke: null});
  }
  get points() { return this.strokes.flatMap(stroke => stroke.points); }
  start(prefectures) {
    if (['waiting', 'drawing', 'judging'].includes(this.phase)) return false;
    this.prefecture = prefectures[Math.floor(this.random() * prefectures.length)];
    this.roundId++; this.strokes = []; this.result = null; this.pointerId = null; this.currentStroke = null;
    this.tool = 'pen'; this.finishedElapsed = null;
    this.startMono = this.now(); this.startWall = this.wall(); this.lastElapsed = 0;
    this.phase = 'waiting'; return true;
  }
  elapsed() {
    this.lastElapsed = Math.max(this.lastElapsed, this.now() - this.startMono, this.wall() - this.startWall);
    return this.lastElapsed;
  }
  tick() {
    if (!['waiting', 'drawing'].includes(this.phase)) return false;
    if (this.elapsed() >= DRAWING_MS) { this.finish(); return true; }
    return false;
  }
  setTool(tool) {
    if (this.tick() || !['waiting', 'drawing'].includes(this.phase) || !['pen', 'eraser'].includes(tool)) return false;
    this.tool = tool; return true;
  }
  down(id, point) {
    if (this.tick() || this.phase !== 'waiting') return false;
    this.phase = 'drawing'; this.pointerId = id;
    this.currentStroke = {tool: this.tool, width: this.tool === 'pen' ? 0.006 : 0.045, points: [[...point]]};
    this.strokes.push(this.currentStroke); return true;
  }
  move(id, point) {
    if (this.tick() || this.phase !== 'drawing' || id !== this.pointerId) return false;
    const previous = this.currentStroke.points.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) this.currentStroke.points.push([...point]);
    return true;
  }
  up(id, point = null) {
    if (this.tick() || this.phase !== 'drawing' || id !== this.pointerId) return;
    if (point) this.move(id, point);
    this.pointerId = null; this.currentStroke = null; this.phase = 'waiting';
  }
  cancel(id) {
    if (this.phase === 'drawing' && id === this.pointerId) {
      this.pointerId = null; this.currentStroke = null; this.phase = 'waiting';
    }
  }
  finish() {
    if (!['waiting', 'drawing'].includes(this.phase)) return;
    this.finishedElapsed = this.elapsed(); this.phase = 'judging';
    this.onFinish({roundId: this.roundId, reference: this.prefecture.outline,
      strokes: this.strokes.map(stroke => ({...stroke, points: stroke.points.map(p => [...p])}))});
  }
  receive(result) {
    if (result.roundId !== this.roundId || this.phase !== 'judging') return false;
    this.result = result; this.phase = result.status === 'error' ? 'judge-error' : 'result'; return true;
  }
}

export class Game {
  constructor(options = {}) {
    this.board = document.querySelector('#board'); this.ctx = this.board.getContext('2d');
    this.ink = document.createElement('canvas'); this.ink.width = INK_SIZE; this.ink.height = INK_SIZE;
    this.workerFactory = options.workerFactory || (() => new Worker(new URL('./judge-worker.js', import.meta.url), {type: 'module'}));
    this.imageFactory = options.imageFactory || createResultImage;
    this.imageGeneration = 0; this.imageState = 'idle'; this.imageUrl = null; this.imageFile = null;
    this.round = new Round({...options, onFinish: data => this.finish(data)});
    this.round.phase = 'loading'; this.worker = null;
    this.board.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.timeStamp < this.eventStart) return;
      if (this.round.down(event.pointerId, this.point(event))) {
        try { this.board.setPointerCapture(event.pointerId); } catch { /* synthetic pointer has no OS capture */ }
        this.render();
      }
    });
    this.board.addEventListener('pointermove', event => {
      if (event.timeStamp >= this.eventStart && this.round.move(event.pointerId, this.point(event))) this.draw();
    });
    this.board.addEventListener('pointerup', event => {
      if (event.timeStamp < this.eventStart) return;
      this.round.up(event.pointerId, this.point(event)); this.render();
    });
    for (const type of ['pointercancel', 'lostpointercapture']) this.board.addEventListener(type, event => {
      if (event.timeStamp >= this.eventStart) { this.round.cancel(event.pointerId); this.render(); }
    });
    document.addEventListener('visibilitychange', () => this.tick());
    window.addEventListener('pageshow', () => this.tick()); window.addEventListener('resize', () => this.draw());
    document.querySelector('#start').addEventListener('click', () => this.start());
    document.querySelector('#reload').addEventListener('click', () => this.load());
    for (const tool of ['pen', 'eraser']) document.querySelector('#' + tool).addEventListener('click', () => {
      this.round.setTool(tool); this.render();
    });
    document.querySelector('#share-image').addEventListener('click', () => this.shareImage());
    document.querySelector('#retry-image').addEventListener('click', () => this.prepareImage());
    this.ready = this.load();
    const animate = () => { this.tick(); requestAnimationFrame(animate); }; requestAnimationFrame(animate);
  }
  clearImage() {
    this.imageGeneration++;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null; this.imageFile = null; this.imageState = 'idle'; this.imageSharePending = false;
    document.querySelector('#result-preview').removeAttribute('src');
    document.querySelector('#save-image').removeAttribute('href');
  }
  async load() {
    this.worker?.terminate(); this.worker = null; this.clearImage(); this.data = null;
    Object.assign(this.round, {strokes: [], result: null, prefecture: null, pointerId: null,
      currentStroke: null, tool: 'pen', startMono: undefined, finishedElapsed: null});
    this.round.phase = 'loading'; this.render();
    try {
      const response = await fetch(new URL('./data/prefectures.json', import.meta.url));
      if (!response.ok) throw new Error('data unavailable');
      this.data = validateDataset(await response.json()); this.round.phase = 'ready';
    } catch { this.round.phase = 'load-error'; }
    this.render();
  }
  start() {
    if (!this.data || !this.round.start(this.data.prefectures)) return;
    this.worker?.terminate(); this.worker = null; this.clearImage();
    this.eventStart = performance.now(); this.render();
    if (matchMedia('(max-width: 760px)').matches) document.querySelector('.drawing-card').scrollIntoView({block: 'start', behavior: 'instant'});
  }
  point(event) {
    const rect = this.board.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  }
  finish(data) {
    const id = this.round.pointerId;
    if (id !== null && this.board.hasPointerCapture(id)) this.board.releasePointerCapture(id);
    paintStrokes(this.ink, data.strokes); const mask = inkMask(this.ink); this.render();
    try {
      this.worker = this.workerFactory(); this.worker.onmessage = event => this.receive(event.data);
      this.worker.onerror = () => this.receive({roundId: data.roundId, status: 'error', reason: '判定できませんでした'});
      this.worker.onmessageerror = this.worker.onerror;
      this.worker.postMessage({roundId: data.roundId, reference: data.reference, mask, size: INK_SIZE, strokes: data.strokes});
    } catch { this.receive({roundId: data.roundId, status: 'error', reason: '判定できませんでした'}); }
  }
  receive(data) {
    if (!this.round.receive(data)) return;
    this.worker?.terminate(); this.worker = null; this.render();
    if (data.status !== 'error') this.prepareImage();
  }
  async prepareImage() {
    if (this.round.phase !== 'result') return;
    const id = this.round.roundId, generation = ++this.imageGeneration;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null; this.imageFile = null; this.imageState = 'preparing'; this.renderImage();
    const snapshot = document.createElement('canvas'); snapshot.width = INK_SIZE; snapshot.height = INK_SIZE;
    snapshot.getContext('2d').drawImage(this.ink, 0, 0);
    const result = this.round.result, prefecture = this.round.prefecture;
    try {
      const blob = await this.imageFactory({prefecture, result, ink: snapshot, label: verdict(result),
        overlapText: percent(result.iou), distanceText: percent(result.distance95)});
      if (id !== this.round.roundId || generation !== this.imageGeneration || this.round.phase !== 'result') return;
      if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new Error('invalid image');
      this.imageFile = new File([blob], 'prefecture-' + prefecture.code + '-result.png', {type: 'image/png'});
      this.imageUrl = URL.createObjectURL(blob); this.imageState = 'ready';
    } catch {
      if (id !== this.round.roundId || generation !== this.imageGeneration) return;
      this.imageState = 'failed';
    }
    this.renderImage();
  }
  async shareImage() {
    if (this.round.phase !== 'result' || this.imageState !== 'ready' || this.imageSharePending) return;
    const id = this.round.roundId, generation = this.imageGeneration, file = this.imageFile;
    const note = document.querySelector('#image-status');
    try {
      if (!navigator.share || !navigator.canShare?.({files: [file]})) {
        note.textContent = 'この端末では画像を保存し、Xの投稿画面で添付してください。'; return;
      }
      const intent = new URL(shareLink(this.round.prefecture, this.round.result,
        document.querySelector('meta[name="game-share-url"]').content));
      const text = intent.searchParams.get('text') + (intent.searchParams.has('url') ? '\n' + intent.searchParams.get('url') : '');
      this.imageSharePending = true; document.querySelector('#share-image').disabled = true;
      await navigator.share({files: [file], title: '記憶だけで都道府県', text});
      if (id === this.round.roundId && generation === this.imageGeneration) note.textContent = '共有メニューを閉じました。投稿内容は共有先で確認してください。';
    } catch (error) {
      if (id === this.round.roundId && generation === this.imageGeneration) note.textContent = error.name === 'AbortError' ?
        '共有をキャンセルしました。結果はそのまま残っています。' : '画像を共有できませんでした。画像を保存してXで添付できます。';
    } finally {
      if (id === this.round.roundId && generation === this.imageGeneration) {
        this.imageSharePending = false; document.querySelector('#share-image').disabled = false;
      }
    }
  }
  tick() {
    this.round.tick();
    if (['waiting', 'drawing'].includes(this.round.phase)) {
      const remaining = Math.max(0, DRAWING_MS - this.round.elapsed());
      document.querySelector('#remaining').textContent = (Math.ceil(remaining / 100) / 10).toFixed(1);
      document.querySelector('#time-bar').style.width = (remaining / DRAWING_MS * 100) + '%';
      document.querySelector('.clock').classList.toggle('urgent', remaining <= 5000);
    }
  }
  renderImage() {
    const select = id => document.querySelector(id);
    select('#image-panel').hidden = this.round.phase !== 'result';
    select('#retry-image').hidden = this.imageState !== 'failed';
    select('#share-image').disabled = this.imageState !== 'ready' || this.imageSharePending;
    select('#save-image').hidden = this.imageState !== 'ready'; select('#image-preview').hidden = this.imageState !== 'ready';
    select('#image-status').textContent = ({idle: '結果画像を準備しています…', preparing: '結果画像を作っています…',
      ready: '共有メニューでXを選択。ない場合は画像を保存して添付できます。', failed: '画像を作れませんでした。もう一度作成できます。'})[this.imageState];
    if (this.imageState === 'ready' && this.imageUrl) {
      select('#result-preview').src = this.imageUrl; select('#save-image').href = this.imageUrl;
      select('#save-image').download = this.imageFile.name;
    } else { select('#result-preview').removeAttribute('src'); select('#save-image').removeAttribute('href'); }
  }
  render() {
    const {phase, result, prefecture} = this.round;
    const done = ['result', 'judge-error'].includes(phase), active = ['waiting', 'drawing'].includes(phase);
    const select = id => document.querySelector(id);
    select('#prompt').textContent = prefecture?.name || (phase === 'loading' ? '準備中' : '何県が出るかな？');
    select('#start').disabled = !['ready', 'result', 'judge-error'].includes(phase);
    select('#start').innerHTML = done ? 'もう一度 <span aria-hidden="true">→</span>' : 'スタート <span aria-hidden="true">→</span>';
    select('#rules').hidden = done; select('#result-panel').hidden = !done;
    select('#canvas-hint').hidden = active || phase === 'judging' || done; select('#reload').hidden = phase !== 'load-error';
    for (const tool of ['pen', 'eraser']) {
      select('#' + tool).disabled = !active; select('#' + tool).setAttribute('aria-pressed', String(this.round.tool === tool));
    }
    this.board.classList.toggle('erasing', this.round.tool === 'eraser' && active);
    select('#status').textContent = ({loading: 'データを読み込んでいます…', ready: '準備ができました。',
      waiting: '15秒までは、何度でも描き足せます。', drawing: this.round.tool === 'eraser' ? '消した部分は採点に含まれません。' : '線をつないで、輪郭を閉じよう。',
      judging: '輪郭を比べています…', result: '画像を保存して、あなたの一県をシェア。',
      'judge-error': 'もう一度、新しいお題で試せます。', 'load-error': '正解データを読み込めませんでした。再読み込みしてください。'})[phase];
    select('#drawing-note').textContent = done ? '位置と大きさを揃えて比較しています。' :
      phase === 'judging' ? '描画終了。答え合わせ中…' : '15秒で、輪郭をつなごう。消しゴムも使えます。';
    select('#share').hidden = true; select('#share').removeAttribute('href');
    if (done) {
      select('#verdict').textContent = verdict(result);
      select('#result-panel').classList.toggle('correct', result.status === 'correct');
      select('#result-panel').classList.toggle('error', result.status === 'error');
      select('#reason').textContent = result.status === 'error' ? '回答は残っています。もう一度、新しいお題で試せます。' :
        result.reason || (result.status === 'correct' ? 'その輪郭、しっかり覚えていますね。' : '正解の輪郭と、どこが違った？');
      select('#iou').textContent = percent(result.iou); select('#distance').textContent = percent(result.distance95);
      const link = shareLink(prefecture, result, select('meta[name="game-share-url"]').content);
      if (link) { select('#share').href = link; select('#share').hidden = false; }
    }
    if (!active) {
      const remaining = this.round.startMono === undefined ? DRAWING_MS : Math.max(0, DRAWING_MS - (this.round.finishedElapsed ?? this.round.elapsed()));
      select('#remaining').textContent = (Math.ceil(remaining / 100) / 10).toFixed(1);
      select('#time-bar').style.width = (remaining / DRAWING_MS * 100) + '%';
    }
    this.renderImage(); this.draw();
  }
  draw() {
    paintStrokes(this.ink, this.round.strokes);
    const width = this.board.getBoundingClientRect().width; if (!width) return;
    this.board.width = Math.round(width * (window.devicePixelRatio || 1)); this.board.height = this.board.width;
    const ctx = this.ctx; ctx.setTransform(this.board.width, 0, 0, this.board.height, 0, 0);
    if (['result', 'judge-error'].includes(this.round.phase)) drawComparison(ctx, {x: 0, y: 0, size: 1}, this.ink, this.round.prefecture.outline, this.round.result);
    else ctx.drawImage(this.ink, 0, 0, 1, 1);
  }
}

export const game = document.querySelector('#board') ? new Game() : null;
