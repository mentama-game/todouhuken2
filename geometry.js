// All coordinates are logical units. No DOM, network or device pixels.
const EPS = 1e-12;
const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function clean(points) {
  if (!Array.isArray(points) || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
    throw new Error('座標が不正です');
  }
  const ring = points.filter((p, i) => !i || !equal(p, points[i - 1])).map(p => [...p]);
  if (ring.length > 1 && equal(ring[0], ring.at(-1))) ring.pop();
  return ring;
}

export function signedArea(ring) {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

export function normalize(points) {
  const ring = clean(points);
  if (!ring.length) return [];
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const length = Math.max(maxX - minX, maxY - minY);
  if (!length) return ring.map(() => [0, 0]);
  return ring.map(([x, y]) => [(x - (minX + maxX) / 2) / length, (y - (minY + maxY) / 2) / length]);
}

function onSegment(a, b, p) {
  return cross(a, b, p) === 0 &&
    p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function invalidReason(ring) {
  if (!ring.length) return '描画されていません';
  if (new Set(ring.map(p => p.join(','))).size < 3) return '輪郭を描いてください (異なる点が3つ必要です)';
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], prev = ring[(i + ring.length - 1) % ring.length];
    // Adjacent segments may meet, but must not double back over one another.
    if (cross(prev, a, b) === 0 &&
        (prev[0] - a[0]) * (b[0] - a[0]) + (prev[1] - a[1]) * (b[1] - a[1]) > EPS) {
      return '輪郭が交差または接触しています';
    }
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return '輪郭が交差または接触しています';
    }
  }
  if (Math.abs(signedArea(ring)) <= EPS) return '輪郭に面積がありません';
  return null;
}

export function occupancy(ring, size = 512) {
  const mask = new Uint8Array(size * size);
  const fill = (row, left, right) => {
    const start = Math.max(0, Math.ceil((left + 0.5) * size - 0.5 - EPS));
    const end = Math.min(size - 1, Math.floor((right + 0.5) * size - 0.5 + EPS));
    if (end >= start) mask.fill(1, row * size + start, row * size + end + 1);
  };
  for (let row = 0; row < size; row++) {
    const y = (row + 0.5) / size - 0.5;
    const intersections = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] > y) !== (b[1] > y)) {
        intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      if (Math.abs(a[1] - y) <= EPS && Math.abs(b[1] - y) <= EPS) {
        fill(row, Math.min(a[0], b[0]), Math.max(a[0], b[0]));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) fill(row, intersections[i], intersections[i + 1]);
  }
  return mask;
}

export function overlap(a, b) {
  const first = occupancy(a), second = occupancy(b);
  let intersection = 0, union = 0;
  for (let i = 0; i < first.length; i++) {
    intersection += first[i] & second[i];
    union += first[i] | second[i];
  }
  return union ? intersection / union : null;
}

export function sample(ring, count = 512) {
  let ordered = [...ring];
  if (signedArea(ordered) < 0) ordered.reverse();
  let start = 0;
  ordered.forEach((p, i) => {
    const q = ordered[start];
    if (p[1] < q[1] || (p[1] === q[1] && p[0] < q[0])) start = i;
  });
  ordered = ordered.slice(start).concat(ordered.slice(0, start));
  const lengths = ordered.map((p, i) => Math.hypot(p[0] - ordered[(i + 1) % ordered.length][0], p[1] - ordered[(i + 1) % ordered.length][1]));
  const perimeter = lengths.reduce((a, b) => a + b, 0);
  const points = [];
  let edge = 0, passed = 0;
  for (let i = 0; i < count; i++) {
    const distance = i * perimeter / count;
    while (edge < lengths.length - 1 && passed + lengths[edge] < distance) passed += lengths[edge++];
    const t = lengths[edge] ? (distance - passed) / lengths[edge] : 0;
    const a = ordered[edge], b = ordered[(edge + 1) % ordered.length];
    points.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
  }
  return points;
}

export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const t = squared ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function percentile95(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(0.95 * ordered.length) - 1];
}

export function contourDistance(a, b) {
  const distances = (from, to) => sample(from).map(p => {
    let closest = Infinity;
    for (let i = 0; i < to.length; i++) closest = Math.min(closest, pointSegmentDistance(p, to[i], to[(i + 1) % to.length]));
    return closest;
  });
  return percentile95(distances(a, b).concat(distances(b, a)));
}

export function passes(iou, distance95) {
  return Number.isFinite(iou) && Number.isFinite(distance95) && iou >= 0.85 && distance95 <= 0.05;
}

export function judge(reference, answer) {
  const target = normalize(reference);
  if (invalidReason(target)) throw new Error('正解データが不正です');
  const normalizedAnswer = normalize(answer);
  const reason = invalidReason(normalizedAnswer);
  if (reason) return {status: 'incorrect', reason, iou: null, distance95: null, normalizedAnswer};
  const first = occupancy(normalizedAnswer), second = occupancy(target);
  if (!first.some(Boolean) || !second.some(Boolean)) {
    return {status: 'incorrect', reason: '輪郭の面積が小さすぎて比較できません', iou: null, distance95: null, normalizedAnswer};
  }
  const iou = overlap(normalizedAnswer, target), distance95 = contourDistance(normalizedAnswer, target);
  return {status: passes(iou, distance95) ? 'correct' : 'incorrect', reason: '', iou, distance95, normalizedAnswer};
}

// Extract a closed region from the final visible ink, after erasing. Four-neighbor
// flood fill keeps separate strokes separate; missing edges are never invented.
export function extractRegion(mask, size = 512) {
  if (!Number.isInteger(size) || size < 2 || size > 512 || mask.length !== size * size) throw new Error('描画マスクが不正です');
  const state = Uint8Array.from(mask, v => v ? 1 : 0);
  if (!state.some(Boolean)) return {reason: '描画されていません'};
  const queue = new Int32Array(state.length);
  let head = 0, tail = 0;
  const outside = i => { if (state[i] === 0) { state[i] = 2; queue[tail++] = i; } };
  for (let p = 0; p < size; p++) {
    outside(p); outside((size - 1) * size + p); outside(p * size); outside(p * size + size - 1);
  }
  const visitNeighbors = (index, visit) => {
    const x = index % size, y = Math.floor(index / size);
    if (x) visit(index - 1); if (x + 1 < size) visit(index + 1);
    if (y) visit(index - size); if (y + 1 < size) visit(index + size);
  };
  while (head < tail) visitNeighbors(queue[head++], outside);
  // Include the boundary ink as well as its enclosed space. Excluding the ink
  // would cut off narrow peninsulas when the two coast strokes touch.
  let largest = [];
  for (let i = 0; i < state.length; i++) {
    if (state[i] === 2 || state[i] === 4) continue;
    let hasInterior = state[i] === 0;
    head = 0; tail = 0; state[i] = 4; queue[tail++] = i;
    const component = [];
    while (head < tail) {
      const index = queue[head++]; component.push(index);
      visitNeighbors(index, neighbor => {
        if (state[neighbor] !== 2 && state[neighbor] !== 4) {
          if (state[neighbor] === 0) hasInterior = true;
          state[neighbor] = 4; queue[tail++] = neighbor;
        }
      });
    }
    if (hasInterior && component.length > largest.length) largest = component;
  }
  if (!largest.length) return {reason: '線をつないで輪郭を閉じてください'};
  const region = new Uint8Array(state.length);
  for (const index of largest) region[index] = 1;
  const edges = new Map();
  const stride = size + 1;
  let start = Infinity, edgeCount = 0;
  const edge = (x, y, nx, ny, direction) => {
    const key = y * stride + x;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push({next: ny * stride + nx, direction});
    start = Math.min(start, key); edgeCount++;
  };
  let minX = size, minY = size, maxX = 0, maxY = 0;
  for (const index of largest) {
    const x = index % size, y = Math.floor(index / size);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
    if (!y || !region[index - size]) edge(x, y, x + 1, y, 0);
    if (x + 1 === size || !region[index + 1]) edge(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === size || !region[index + size]) edge(x + 1, y + 1, x, y + 1, 2);
    if (!x || !region[index - 1]) edge(x, y + 1, x, y, 3);
  }
  const ring = [];
  let current = start, previousDirection = 0;
  for (let steps = 0; steps <= edgeCount; steps++) {
    ring.push([current % stride, Math.floor(current / stride)]);
    const candidates = edges.get(current);
    if (!candidates?.length) throw new Error('外周を読み取れません');
    const rank = direction => [1, 0, 3, 2].indexOf((direction - previousDirection + 4) % 4);
    const chosen = candidates.reduce((best, item) => rank(item.direction) < rank(best.direction) ? item : best);
    previousDirection = chosen.direction; current = chosen.next;
    if (current === start) break;
    if (steps === edgeCount) throw new Error('外周を閉じられません');
  }
  const outline = ring.filter((point, i) => cross(ring[(i + ring.length - 1) % ring.length], point, ring[(i + 1) % ring.length]) !== 0)
    .map(([x, y]) => [x / size, y / size]);
  return {outline, bounds: [minX, minY, maxX, maxY], area: largest.length, reason: ''};
}

function linearRange(value, delta, min, max) {
  if (Math.abs(delta) < 1e-18) return value >= min && value <= max ? [0, 1] : null;
  const a = (min - value) / delta, b = (max - value) / delta;
  const lo = Math.max(0, Math.min(a, b)), hi = Math.min(1, Math.max(a, b));
  return lo <= hi ? [lo, hi] : null;
}

// Intervals of a pen segment covered by the round capsule swept by an eraser.
function erasedIntervals(a, b, c, d, radius) {
  const minX = Math.min(c[0], d[0]) - radius, maxX = Math.max(c[0], d[0]) + radius;
  const minY = Math.min(c[1], d[1]) - radius, maxY = Math.max(c[1], d[1]) + radius;
  if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX ||
      Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) return [];
  const dx = b[0] - a[0], dy = b[1] - a[1], squared = dx * dx + dy * dy;
  if (!squared) return [];
  const intervals = [];
  for (const center of [c, d]) {
    const ox = a[0] - center[0], oy = a[1] - center[1];
    const dot = ox * dx + oy * dy;
    const discriminant = dot * dot - squared * (ox * ox + oy * oy - radius * radius);
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    const lo = Math.max(0, (-dot - root) / squared), hi = Math.min(1, (-dot + root) / squared);
    if (lo <= hi) intervals.push([lo, hi]);
  }
  const ex = d[0] - c[0], ey = d[1] - c[1], length2 = ex * ex + ey * ey;
  if (length2) {
    const projection = linearRange((a[0] - c[0]) * ex + (a[1] - c[1]) * ey, dx * ex + dy * ey, 0, length2);
    const strip = linearRange(ex * (a[1] - c[1]) - ey * (a[0] - c[0]), ex * dy - ey * dx,
      -radius * Math.sqrt(length2), radius * Math.sqrt(length2));
    if (projection && strip) {
      const lo = Math.max(projection[0], strip[0]), hi = Math.min(projection[1], strip[1]);
      if (lo <= hi) intervals.push([lo, hi]);
    }
  }
  return intervals;
}

export function visibleChains(strokes) {
  let chains = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-10;
  for (const stroke of strokes) {
    if (stroke.tool === 'pen') { if (stroke.points.length > 1) chains.push(stroke.points.map(p => [...p])); continue; }
    if (stroke.tool !== 'eraser' || !stroke.points.length) continue;
    const eraseSegments = stroke.points.length === 1 ? [[stroke.points[0], stroke.points[0]]] :
      stroke.points.slice(1).map((p, i) => [stroke.points[i], p]);
    const nextChains = [];
    for (const chain of chains) {
      const fragments = []; let active = null;
      for (let i = 0; i + 1 < chain.length; i++) {
        const a = chain[i], b = chain[i + 1]; let remaining = [[0, 1]];
        for (const [c, d] of eraseSegments) {
          for (const [lo, hi] of erasedIntervals(a, b, c, d, stroke.width / 2)) {
            remaining = remaining.flatMap(([from, to]) => hi <= from || lo >= to ? [[from, to]] :
              [[from, Math.min(lo, to)], [Math.max(hi, from), to]].filter(([u, v]) => v - u > 1e-10));
          }
          if (!remaining.length) break;
        }
        if (!remaining.length) { active = null; continue; }
        for (const [from, to] of remaining) {
          const at = t => t === 0 ? [...a] : t === 1 ? [...b] : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          const first = at(from), last = at(to);
          if (active && close(active.at(-1), first)) active.push(last);
          else { active = [first, last]; fragments.push(active); }
          if (to < 1) active = null;
        }
      }
      if (fragments.length > 1 && close(fragments.at(-1).at(-1), fragments[0][0])) {
        fragments[0] = fragments.at(-1).concat(fragments[0].slice(1)); fragments.pop();
      }
      nextChains.push(...fragments);
    }
    chains = nextChains;
  }
  return chains;
}

export function contourFromStrokes(strokes, size = 512) {
  const chains = visibleChains(strokes), candidates = [];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const tolerance = 0.006; // Round pen caps already touch within this distance.
  while (chains.length) {
    let chain = chains.shift();
    while (distance(chain[0], chain.at(-1)) > tolerance) {
      let best = null;
      chains.forEach((other, index) => {
        for (const reverse of [false, true]) {
          const gap = distance(chain.at(-1), reverse ? other.at(-1) : other[0]);
          if (gap <= tolerance && (!best || gap < best.gap)) best = {index, reverse, gap};
        }
      });
      if (!best) break;
      const addition = chains.splice(best.index, 1)[0];
      if (best.reverse) addition.reverse();
      chain = chain.concat(addition);
    }
    if (distance(chain[0], chain.at(-1)) > tolerance) continue;
    const outline = clean(chain);
    if (!invalidReason(normalize(outline))) candidates.push(outline);
  }
  if (!candidates.length) return null;
  const outline = candidates.reduce((best, ring) => Math.abs(signedArea(ring)) > Math.abs(signedArea(best)) ? ring : best);
  const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
  return {outline, bounds: [Math.min(...xs) * size, Math.min(...ys) * size, Math.max(...xs) * size, Math.max(...ys) * size], reason: ''};
}

export function judgeMask(reference, mask, size = 512, strokes = []) {
  const extracted = contourFromStrokes(strokes, size) || extractRegion(mask, size);
  if (extracted.reason) return {status: 'incorrect', reason: extracted.reason, iou: null, distance95: null, normalizedAnswer: [], bounds: null};
  return {...judge(reference, extracted.outline), bounds: extracted.bounds};
}
