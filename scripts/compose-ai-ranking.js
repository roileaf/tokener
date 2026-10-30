import { MODULE_ID } from './constants.js';
import { getTokenFrameLayout } from './token-composer.js';

// A small non-generative classifier trained on paired original/ringed tokens. The model predicts
// which portions of the rim should sit behind the subject, not any new image pixels. Ranking is
// deliberately advisory: existing hand-designed scoring remains the dominant signal.
const MODEL_PATH = `modules/${MODULE_ID}/models/occlusion-forest.json`;
const MODEL_BONUS = 0.04;
const SECTORS = 36;
let modelPromise;

export function loadComposeRankingModel() {
  modelPromise ??= (async () => {
    const path = globalThis.foundry?.utils?.getRoute?.(MODEL_PATH) ?? MODEL_PATH;
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const model = await response.json();
    if (model.kind !== 'rim-occlusion-forest-v1' || model.feature_length !== 9 || !model.trees?.length)
      throw new Error('Unsupported composition model');
    return model;
  })().catch((error) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

function frontProbability(features, model) {
  let sum = 0;
  for (const tree of model.trees) {
    let node = 0;
    while (tree.left[node] >= 0) {
      const feature = tree.feature[node];
      node = features[feature] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    }
    sum += tree.probs[node][1];
  }
  return sum / model.trees.length;
}

/** A candidate's ring-adjacent alpha occupancy and chosen pop-out sectors. */
export function candidateRimFeatures(candidate, alpha, clipRadius) {
  const { gridSize, occupied } = candidate.protrusions;
  const center = gridSize / 2;
  const radius = center * clipRadius;
  const layout = getTokenFrameLayout({
    imageWidth: alpha.width,
    imageHeight: alpha.height,
    size: gridSize,
    zoom: candidate.view.zoom,
    offsetX: candidate.view.offsetX * gridSize,
    offsetY: candidate.view.offsetY * gridSize,
  });
  const sum = Array.from({ length: SECTORS }, () => [0, 0, 0, 0]);
  const count = Array.from({ length: SECTORS }, () => [0, 0, 0, 0]);

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const relative = (Math.hypot(dx, dy) - radius) / radius;
      let band = -1;
      if (relative > -0.135 && relative < -0.018) band = 0;
      else if (Math.abs(relative) < 0.042) band = 1;
      else if (relative > 0.018 && relative < 0.135) band = 2;
      if (band < 0) continue;
      const angle = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
      const sector = Math.min(SECTORS - 1, Math.floor((angle * SECTORS) / (2 * Math.PI)));
      const i = y * gridSize + x;
      const on = Number(occupied[i] > 0);
      sum[sector][band] += on;
      count[sector][band] += 1;
      if (band === 2) {
        sum[sector][3] += Number(candidate.popOutMask[i] > 0);
        count[sector][3] += 1;
      }
    }
  }

  return sum.map((values, i) => {
    const angle = ((i + 0.5) * 2 * Math.PI) / SECTORS;
    return {
      features: [
        Math.cos(angle),
        Math.sin(angle),
        ...values.slice(0, 3).map((value, band) => value / Math.max(1, count[i][band])),
        layout.x / gridSize,
        layout.y / gridSize,
        layout.width / gridSize,
        layout.height / gridSize,
      ],
      selected: values[3] / Math.max(1, count[i][3]),
      occupancy: values[1] / Math.max(1, count[i][1]),
    };
  });
}

/**
 * Adds at most ±0.02 to the original score. No new candidates or masks are generated;
 * the model only breaks close ties among Tokener's existing compositions.
 */
export function rerankComposeCandidates(candidates, alpha, clipRadius, model) {
  if (!model || model.feature_length !== 9) return candidates;
  return candidates
    .map((candidate) => {
      const sectors = candidateRimFeatures(candidate, alpha, clipRadius);
      let weighted = 0;
      let total = 0;
      for (const sector of sectors) {
        if (sector.occupancy < 0.15) continue;
        const probability = frontProbability(sector.features, model);
        const confidence = Math.abs(probability - 0.5) * 2;
        weighted += confidence * (1 - Math.abs(probability - sector.selected));
        total += confidence;
      }
      const agreement = total ? weighted / total : 0.5;
      const learnedBonus = MODEL_BONUS * (agreement - 0.5);
      return { ...candidate, score: candidate.score + learnedBonus, learnedBonus };
    })
    .sort((a, b) => b.score - a.score);
}
