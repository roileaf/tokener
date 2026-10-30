import {
  candidateRimFeatures,
  rerankComposeCandidates,
} from '../scripts/compose-ai-ranking.js';

function candidate(selected = false, score = 1) {
  const gridSize = 96;
  const occupied = new Uint8Array(gridSize * gridSize);
  const popOutMask = new Uint8Array(gridSize * gridSize);
  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const distance = Math.hypot(x + 0.5 - 48, y + 0.5 - 48);
      if (distance > 32 && distance < 42) {
        occupied[y * gridSize + x] = 1;
        if (selected) popOutMask[y * gridSize + x] = 1;
      }
    }
  }
  return {
    score,
    view: { zoom: 1, offsetX: 0, offsetY: 0 },
    protrusions: { gridSize, occupied },
    popOutMask,
  };
}

const model = {
  kind: 'rim-occlusion-forest-v1',
  feature_length: 9,
  trees: [
    { left: [-1], right: [-1], feature: [-2], threshold: [-2], probs: [[0, 1]] },
  ],
};

describe('experimental learned composition ranking', () => {
  test('generates 36 nine-feature sectors for a Tokener candidate', () => {
    const sectors = candidateRimFeatures(candidate(true), { width: 128, height: 128 }, 0.8);
    expect(sectors).toHaveLength(36);
    expect(sectors.every((sector) => sector.features.length === 9)).toBe(true);
    expect(sectors.flatMap((sector) => sector.features).every(Number.isFinite)).toBe(true);
  });

  test('prefers an agreeing pop-out mask but limits its influence', () => {
    const plain = candidate(false);
    const popped = candidate(true);
    const ranked = rerankComposeCandidates([plain, popped], { width: 128, height: 128 }, 0.8, model);
    expect(ranked[0].popOutMask).toBe(popped.popOutMask);
    expect(ranked.every((item) => Math.abs(item.learnedBonus) <= 0.020000001)).toBe(true);
    expect(plain.score).toBe(1);
    expect(popped.score).toBe(1);
  });

  test('leaves ranking unchanged without a compatible model', () => {
    const originals = [candidate(false), candidate(true)];
    expect(rerankComposeCandidates(originals, { width: 128, height: 128 }, 0.8, null)).toBe(originals);
  });
});
