import {judgeMask} from './geometry.js';

self.onmessage = ({data}) => {
  try {
    self.postMessage({roundId: data.roundId, ...judgeMask(data.reference, data.mask, data.size, data.strokes)});
  } catch {
    self.postMessage({roundId: data.roundId, status: 'error', reason: '判定できませんでした', iou: null, distance95: null});
  }
};
