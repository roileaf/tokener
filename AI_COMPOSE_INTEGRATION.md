# Experimental AI-assisted Auto Compose ranking

This is an optional, non-generative classifier integrated into **Tokener**. It does not
generate art, remove backgrounds, or replace the existing composition engine. It uses
rim occupancy and the proposed pop-out mask to add a small adjustment (at most 0.02)
to each Auto Compose candidate's heuristic score.

## Behavior

- Uses Tokener's existing **AI Tools** enable setting; disabled means no model download.
- On the first Auto Compose with AI Tools enabled, loads
  `models/occlusion-forest.json` from Tokener's installed module directory.
- The model stays in memory for that client session.
- If downloading or interpreting it fails, Auto Compose continues with its original
  candidate ranking. No network API or user artwork upload is required.
- Existing background removal, masking, SAM refinement, and rendering remain unchanged.

## Model and quality

`occlusion-forest.json` is an experimental 48-tree random forest trained on noisy
automatically extracted labels from user-provided artwork/token pairs. On a held-out
second collection, it achieved approximately 0.596 balanced accuracy at classifying
which rim segments should appear behind the character. This is **not** a polished
production placement model. The bonus is intentionally small and opt-in while further
examples and manual labels are collected.

This model is not trained at runtime, and its inference runs in plain browser JavaScript.
It is far smaller than full image segmentation models.

## Run checks

`npm test -- --runInBand tests/compose-ai-ranking.test.js`

The changed files are `scripts/token-creator.js`, new
`scripts/compose-ai-ranking.js`, `models/occlusion-forest.json`, and
`tests/compose-ai-ranking.test.js`.
