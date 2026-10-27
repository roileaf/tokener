import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyseSubject,
  composeCandidates,
  findProtrusions,
  getAlphaGrid,
  getFramings,
  getPopOutVariants,
  scoreCandidate,
} from '../scripts/auto-compose.js';
import { getTokenFrameLayout } from '../scripts/token-composer.js';

const CLIP = 0.666;
const GRID = 96;

/** 200x300 figure: round head, wide body down to the bottom edge, optional sword above the head. */
function figure({ sword = true, floating = false } = {}) {
  const width = 200;
  const height = 300;
  const alpha = new Uint8Array(width * height);
  const set = (x, y) => {
    if (x >= 0 && y >= 0 && x < width && y < height) alpha[y * width + x] = 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.hypot(x - 100, y - 70) <= 30) set(x, y);
      if (y >= 95 && x >= 55 && x <= 145) set(x, y);
      if (sword && x >= 140 && x <= 147 && y >= 6 && y <= 200) set(x, y);
      if (floating && Math.hypot(x - 20, y - 15) <= 6) set(x, y);
    }
  }
  return { alpha, width, height };
}

function headTokenPosition(view, image, head) {
  const layout = getTokenFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    size: GRID,
    zoom: view.zoom,
    offsetX: view.offsetX * GRID,
    offsetY: view.offsetY * GRID,
  });
  const scale = layout.width / image.width;
  return {
    x: layout.x + head.x * scale,
    y: layout.y + head.y * scale,
    radius: head.radius * scale,
  };
}

test('alpha grid downsamples large images and keeps small ones', () => {
  const data = new Uint8ClampedArray(400 * 200 * 4);
  data[(10 * 400 + 20) * 4 + 3] = 255;
  const grid = getAlphaGrid({ data, width: 400, height: 200 }, 100);
  assert.equal(grid.width, 100);
  assert.equal(grid.height, 50);
  assert.equal(grid.scale, 4);
  assert.ok(grid.alpha[2 * 100 + 5] > 0);
});

test('subject analysis finds the head at the top of the silhouette', () => {
  const analysis = analyseSubject(figure({ sword: false }));
  assert.ok(Math.abs(analysis.head.x - 100) <= 6, `head x ${analysis.head.x}`);
  assert.ok(Math.abs(analysis.head.y - 70) <= 15, `head y ${analysis.head.y}`);
  assert.ok(
    analysis.head.radius >= 18 && analysis.head.radius <= 45,
    `radius ${analysis.head.radius}`,
  );
  assert.deepEqual(analysis.bounds, { x: 55, y: 40, width: 91, height: 260 });
});

test('framings centre the head horizontally at the requested heights and sizes', () => {
  const image = figure({ sword: false });
  const analysis = analyseSubject(image);
  const framings = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP,
  });
  assert.ok(framings.length >= 7);
  const headFramings = framings.filter((framing) => framing.kind === 'head');
  for (const framing of headFramings) {
    const head = headTokenPosition(framing.view, image, analysis.head);
    assert.ok(Math.abs(head.x - GRID / 2) < 1, 'head centred');
    assert.ok(Math.abs(head.y - framing.headY * GRID) < 1, 'head at target height');
    const opening = (GRID / 2) * CLIP;
    assert.ok(Math.abs(head.radius - framing.headSize * opening) < 1, 'head at target size');
  }
  assert.ok(framings.some((framing) => framing.kind === 'figure'));
});

test('protrusions separate a sword above the frame from the cropped body below', () => {
  const image = figure();
  const analysis = analyseSubject(image);
  const framing = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP,
  }).find((entry) => entry.kind === 'head' && entry.headSize >= 0.5);
  const protrusions = findProtrusions({
    alpha: image,
    view: framing.view,
    clipRadius: CLIP,
    gridSize: GRID,
  });
  const upper = protrusions.pieces.filter((piece) => piece.centroid.y < GRID / 2);
  const lower = protrusions.pieces.filter((piece) => piece.inBottomArc);
  assert.ok(
    upper.some((piece) => piece.elongation >= 2.5),
    'sword is a long upper piece',
  );
  assert.ok(lower.length >= 1, 'body is cropped at the bottom');

  const variants = getPopOutVariants(protrusions, { gridSize: GRID, clipRadius: CLIP });
  assert.deepEqual(
    variants.map((variant) => variant.kind),
    ['none', 'top', 'top-parts', 'breakout'],
  );
  for (const variant of variants) {
    for (const id of variant.pieces) {
      assert.equal(protrusions.pieces.find((piece) => piece.id === id).inBottomArc, false);
    }
  }
  const parts = variants.find((variant) => variant.kind === 'top-parts');
  assert.ok(
    parts.pieces.some((id) => protrusions.pieces.find((p) => p.id === id).elongation >= 2.5),
  );
});

test('scoring prefers a well placed head over one pushed off to the bottom', () => {
  const image = figure({ sword: false });
  const analysis = analyseSubject(image);
  const framing = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP,
  }).find((entry) => entry.kind === 'head' && entry.headSize === 0.4 && entry.headY === 0.4);
  const good = { ...framing };
  const bad = { ...framing, view: { ...framing.view, offsetY: framing.view.offsetY + 0.35 } };
  const score = (candidate) => {
    const protrusions = findProtrusions({
      alpha: image,
      view: candidate.view,
      clipRadius: CLIP,
      gridSize: GRID,
    });
    return scoreCandidate({
      framing: candidate,
      head: headTokenPosition(candidate.view, image, analysis.head),
      protrusions,
      variant: { kind: 'none', pieces: [] },
      gridSize: GRID,
      clipRadius: CLIP,
    });
  };
  assert.ok(score(good) > score(bad));
});

test('popping out a floating fragment scores worse than leaving it inside', () => {
  const image = figure({ sword: false, floating: true });
  const analysis = analyseSubject(image);
  const framing = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP,
  }).find((entry) => entry.kind === 'head' && entry.headSize === 0.4 && entry.headY === 0.4);
  const protrusions = findProtrusions({
    alpha: image,
    view: framing.view,
    clipRadius: CLIP,
    gridSize: GRID,
  });
  const floating = protrusions.pieces.filter((piece) => !piece.touchesOpening);
  assert.ok(floating.length >= 1, 'fragment detected');
  const head = headTokenPosition(framing.view, image, analysis.head);
  const base = { framing, head, protrusions, gridSize: GRID, clipRadius: CLIP };
  const withFragment = scoreCandidate({
    ...base,
    variant: { kind: 'top', pieces: floating.map((piece) => piece.id) },
  });
  const without = scoreCandidate({ ...base, variant: { kind: 'none', pieces: [] } });
  assert.ok(without > withFragment);
});

test('compose returns distinct ranked candidates and pops out the sword', () => {
  const image = figure();
  const candidates = composeCandidates({
    alpha: image,
    clipRadius: CLIP,
    gridSize: GRID,
  });
  assert.ok(candidates.length >= 3);
  for (let index = 1; index < candidates.length; index += 1) {
    assert.ok(candidates[index - 1].score >= candidates[index].score, 'sorted by score');
  }
  const keys = new Set(candidates.map((candidate) => candidate.key));
  assert.equal(keys.size, candidates.length, 'distinct');

  const best = candidates[0];
  const head = headTokenPosition(best.view, image, analyseSubject(image).head);
  assert.ok(head.y > GRID * 0.25 && head.y < GRID * 0.5, `head y ${head.y}`);
  const popped = best.pieces.map((id) => best.protrusions.pieces.find((piece) => piece.id === id));
  assert.ok(
    popped.some((piece) => piece.elongation >= 2.5),
    'the sword pops out in the best candidate',
  );
  assert.ok(best.popOutMask instanceof Uint8Array && best.popOutMask.length === GRID * GRID);
});

test('popped masks grow over the subject only', async () => {
  const { expandPopOutMask } = await import('../scripts/auto-compose.js');
  // 5x1 strip: cells 0-3 are subject, cell 4 is empty; cell 0 is popped
  const mask = new Uint8Array([1, 0, 0, 0, 0]);
  const occupied = new Uint8Array([1, 2, 2, 2, 0]);
  assert.deepEqual([...expandPopOutMask(mask, occupied, 5, 2)], [1, 1, 1, 0, 0]);
});

test('close-ups that hit the zoom limit do not produce duplicate layouts', () => {
  const width = 200;
  const height = 200;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.hypot(x - 100, y - 100) <= 98) alpha[y * width + x] = 255;
    }
  }
  const candidates = composeCandidates({ alpha: { alpha, width, height }, clipRadius: CLIP });
  for (let a = 0; a < candidates.length; a += 1) {
    for (let b = a + 1; b < candidates.length; b += 1) {
      const same =
        Math.abs(candidates[a].view.zoom - candidates[b].view.zoom) < 0.02 &&
        Math.abs(candidates[a].view.offsetX - candidates[b].view.offsetX) < 0.01 &&
        Math.abs(candidates[a].view.offsetY - candidates[b].view.offsetY) < 0.01 &&
        candidates[a].pieces.join() === candidates[b].pieces.join();
      assert.equal(same, false, `${candidates[a].key} duplicates ${candidates[b].key}`);
    }
  }
});

test('an image whose edges are still opaque has its background left', async () => {
  const { hasBackgroundLeft } = await import('../scripts/auto-compose.js');
  const full = { alpha: new Uint8Array(20 * 20).fill(255), width: 20, height: 20 };
  assert.equal(hasBackgroundLeft(full), true);
  const cut = { alpha: new Uint8Array(20 * 20), width: 20, height: 20 };
  for (let y = 5; y < 20; y += 1) for (let x = 5; x < 15; x += 1) cut.alpha[y * 20 + x] = 255;
  assert.equal(hasBackgroundLeft(cut), false, 'a figure cropped at the bottom edge is fine');
});

test('pop-out framings lift the top of the head above the frame opening', () => {
  const image = figure({ sword: false });
  const analysis = analyseSubject(image);
  const popouts = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP,
  }).filter((framing) => framing.kind === 'popout');
  assert.ok(popouts.length >= 2);
  const openingTop = GRID / 2 - (GRID / 2) * CLIP;
  for (const framing of popouts) {
    const head = headTokenPosition(framing.view, image, analysis.head);
    assert.ok(head.y - head.radius < openingTop, 'head top above the opening');
    assert.ok(head.y > openingTop, 'but the head centre stays inside');
  }
});

test('compose options always offer both a pop-out and a contained layout', async () => {
  const { pickComposeOptions } = await import('../scripts/auto-compose.js');
  const candidates = composeCandidates({
    alpha: figure({ sword: false }),
    clipRadius: CLIP,
    limit: 40,
  });
  const options = pickComposeOptions(candidates, 4);
  assert.equal(options.length, 4);
  assert.ok(
    options.some((option) => option.pieces.length > 0),
    'a pop-out option',
  );
  assert.ok(
    options.some((option) => option.pieces.length === 0),
    'a contained option',
  );
  assert.equal(new Set(options.map((option) => option.key)).size, 4);
});

test('breakout pops out compact side parts that the top choices leave inside', () => {
  const width = 200;
  const height = 300;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const head = Math.hypot(x - 100, y - 70) <= 30;
      const body = y >= 95 && x >= 55 && x <= 145;
      const arm = y >= 110 && y <= 130 && x >= 20 && x <= 55;
      const fist = Math.hypot(x - 24, y - 120) <= 12;
      if (head || body || arm || fist) alpha[y * width + x] = 255;
    }
  }
  const image = { alpha, width, height };
  const analysis = analyseSubject(image);
  const framing = getFramings({
    imageWidth: width,
    imageHeight: height,
    analysis,
    clipRadius: CLIP,
  }).find((entry) => entry.kind === 'head' && entry.headSize === 0.4 && entry.headY === 0.4);
  const protrusions = findProtrusions({
    alpha: image,
    view: framing.view,
    clipRadius: CLIP,
    gridSize: GRID,
  });
  const side = protrusions.pieces.filter(
    (piece) => !piece.inBottomArc && piece.touchesOpening && piece.centroid.x < GRID / 2 - 20,
  );
  assert.ok(side.length >= 1, 'fist breaks out on the left');
  const variants = getPopOutVariants(protrusions, { gridSize: GRID, clipRadius: CLIP });
  const breakout = variants.find((variant) => variant.kind === 'breakout');
  assert.ok(side.every((piece) => breakout.pieces.includes(piece.id)));
  assert.ok(breakout.pieces.every((id) => !protrusions.pieces[id].inBottomArc));
});

test('parts cut off by the source picture edge stay inside the frame', () => {
  const width = 200;
  const height = 300;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const head = Math.hypot(x - 100, y - 90) <= 30;
      const body = y >= 115 && x >= 55 && x <= 145;
      // A blade running off the top of the picture.
      const blade = x >= 140 && x <= 150 && y < 115;
      if (head || body || blade) alpha[y * width + x] = 255;
    }
  }
  const image = { alpha, width, height };
  const analysis = analyseSubject(image);
  for (const framing of getFramings({
    imageWidth: width,
    imageHeight: height,
    analysis,
    clipRadius: CLIP,
  })) {
    const protrusions = findProtrusions({
      alpha: image,
      view: framing.view,
      clipRadius: CLIP,
      gridSize: GRID,
    });
    const cut = protrusions.pieces.filter((piece) => piece.touchesSourceEdge);
    for (const variant of getPopOutVariants(protrusions, { gridSize: GRID, clipRadius: CLIP })) {
      assert.ok(
        cut.every((piece) => !variant.pieces.includes(piece.id)),
        framing.id,
      );
    }
  }
});

test('breakout room fits the popped parts and nothing more', async () => {
  const { fitBreakoutRoom, rescaleView } = await import('../scripts/auto-compose.js');
  const gridSize = 100;
  const ringScale = 1 / 1.5;
  const mask = new Uint8Array(gridSize * gridSize);
  assert.equal(fitBreakoutRoom({ popOutMask: mask, gridSize, ringScale, maxRoom: 50 }), 0);
  // A tip 40 cells above centre: the frame radius is 33.3 cells, so it needs about 25% room.
  mask[10 * gridSize + 50] = 1;
  const room = fitBreakoutRoom({ popOutMask: mask, gridSize, ringScale, maxRoom: 50 });
  assert.equal(room, 25);
  mask[0] = 1;
  assert.equal(fitBreakoutRoom({ popOutMask: mask, gridSize, ringScale, maxRoom: 50 }), 50);

  assert.deepEqual(rescaleView({ zoom: 2, offsetX: 0.1, offsetY: -0.2 }, 0.5, 1), {
    zoom: 4,
    offsetX: 0.2,
    offsetY: -0.4,
  });
});

test('compose with a maximum room gives each candidate the room and view it needs', () => {
  const image = figure({ sword: true });
  const ringScale = 1 / 1.5;
  const candidates = composeCandidates({
    alpha: image,
    clipRadius: CLIP * ringScale,
    ringScale,
    maxRoom: 50,
    gridSize: GRID,
    limit: 40,
  });
  const contained = candidates.find((candidate) => candidate.pieces.length === 0);
  assert.equal(contained.fit.room, 0);
  assert.equal(contained.fit.view.zoom, contained.view.zoom * 1.5);
  const popped = candidates.find((candidate) => candidate.pieces.length > 0);
  assert.ok(popped.fit.room > 0 && popped.fit.room <= 50);
});

test('framings place the head relative to a ring drawn smaller inside the token', () => {
  const image = figure({ sword: false });
  const analysis = analyseSubject(image);
  const ringScale = 0.8;
  const framing = getFramings({
    imageWidth: image.width,
    imageHeight: image.height,
    analysis,
    clipRadius: CLIP * ringScale,
    ringScale,
  }).find((entry) => entry.kind === 'head' && entry.headY === 0.4);
  const head = headTokenPosition(framing.view, image, analysis.head);
  assert.ok(Math.abs(head.y - (0.5 + (0.4 - 0.5) * ringScale) * GRID) < 1);
});
