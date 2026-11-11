import {normalize} from './geometry.js';

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 960;

// The same comparison is used by the live result and the export. Draw the final
// ink bitmap (not historical pen strokes), so erased lines cannot reappear.
export function drawComparison(ctx, rect, ink, reference, result) {
  const {x, y, size} = rect;
  const scale = size * 0.82;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  ctx.beginPath(); ctx.strokeStyle = '#608fa6'; ctx.lineWidth = size * 0.004;
  ctx.setLineDash([size * 0.012, size * 0.008]);
  normalize(reference).forEach(([px, py], i) => {
    const dx = x + size / 2 + px * scale, dy = y + size / 2 + py * scale;
    if (i) ctx.lineTo(dx, dy); else ctx.moveTo(dx, dy);
  });
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  if (result.bounds) {
    const [minX, minY, maxX, maxY] = result.bounds;
    const length = Math.max(maxX - minX, maxY - minY);
    const ratio = scale / length;
    ctx.drawImage(ink, x + size / 2 - (minX + maxX) / 2 * ratio,
      y + size / 2 - (minY + maxY) / 2 * ratio, ink.width * ratio, ink.height * ratio);
  } else ctx.drawImage(ink, x + size * 0.09, y + size * 0.09, scale, scale);
  ctx.restore();
}

function wrappedText(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const character of text) {
    if (ctx.measureText(line + character).width > maxWidth && line) {
      ctx.fillText(line, x, y); line = ''; y += lineHeight;
    }
    line += character;
  }
  if (line) ctx.fillText(line, x, y);
}

export function renderResultImage({prefecture, result, ink, label, overlapText, distanceText}) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_WIDTH; canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  const font = '"Yu Gothic", "Hiragino Kaku Gothic ProN", system-ui, sans-serif';
  ctx.fillStyle = '#f5f3ed'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#202a2b'; ctx.font = `700 29px ${font}`;
  ctx.fillText('記憶だけで都道府県', 60, 65);
  ctx.fillStyle = '#788181'; ctx.font = `22px ${font}`;
  ctx.fillText('15秒、記憶だけ。', 925, 65);
  ctx.fillStyle = '#202a2b'; ctx.font = `800 74px ${font}`;
  ctx.fillText(prefecture.name, 60, 175);
  ctx.fillStyle = result.status === 'correct' ? '#397a65' : '#e75b35';
  ctx.font = `700 40px ${font}`; ctx.fillText(label, 835, 167);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(60, 220, 680, 680);
  ctx.strokeStyle = '#dedfd7'; ctx.lineWidth = 2; ctx.strokeRect(60, 220, 680, 680);
  drawComparison(ctx, {x: 60, y: 220, size: 680}, ink, prefecture.outline, result);
  ctx.fillStyle = '#788181'; ctx.font = `24px ${font}`; ctx.fillText('輪郭のずれ', 805, 285);
  ctx.fillStyle = '#202a2b'; ctx.font = `700 ${distanceText === '—' ? 40 : 70}px ${font}`;
  ctx.fillText(distanceText === '—' ? '算出不可' : distanceText, 805, 375);
  ctx.fillStyle = '#788181'; ctx.font = `21px ${font}`; ctx.fillText('長辺に対する距離の割合', 805, 415);
  ctx.font = `24px ${font}`; ctx.fillText('重なり率', 805, 495);
  ctx.fillStyle = '#202a2b'; ctx.font = `700 48px ${font}`;
  ctx.fillText(overlapText === '—' ? '算出不可' : overlapText, 805, 560);
  ctx.font = `22px ${font}`; ctx.fillStyle = '#e75b35'; ctx.fillText('━ あなたの輪郭', 805, 645);
  ctx.fillStyle = '#608fa6'; ctx.fillText('┄ 正解の輪郭', 805, 685);
  ctx.fillStyle = '#788181'; ctx.font = `20px ${font}`;
  wrappedText(ctx, result.reason || '位置と大きさを揃えて比較。重なり85%以上・輪郭ずれ5%以内で正解。', 805, 755, 330, 32);
  ctx.font = `17px ${font}`;
  ctx.fillText('出典：国土交通省「国土数値情報(行政区域)」2026年版を加工 / CC BY 4.0', 60, 940);
  return canvas;
}

export async function createResultImage(options) {
  const canvas = renderResultImage(options);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を作成できませんでした')), 'image/png');
  });
}
