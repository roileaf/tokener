# Auto compose for the Token Creator

## Intent

GMs want to drop in a character portrait and get a good-looking token without hand-tuning. Auto
compose decides where the head is, how large and where to place the art in the frame, and which
parts break out of the frame or dynamic ring, then offers a few alternatives to choose from.

## Goals

- One click (**Auto compose**) frames the current token art and sets its pop-out mask.
- Produces several distinct candidates, scores them, applies the best and shows the top four as
  thumbnails; clicking a thumbnail applies it.
- Works without AI tools (silhouette heuristics only); with AI tools enabled it uses the existing
  Segment Anything model to refine the head and to pop out whole parts (an entire sword, not just
  its tip).
- Everything it sets stays editable: zoom, position, pop-out brushes, undo.

## Non-goals

- Naming parts ("sword", "horns"). Candidates reason about shape (long, thin, pointing up) only.
- New model downloads. Large detectors (OWL-ViT, Grounding DINO, Florence-2: 130–460 MB) were
  ruled out for size and, for Florence-2, Foundry's generative AI policy.
- Portrait framing (token only for now).

## Anti-goals

- Silently overwriting a user's hand-painted pop-out mask without a way back (it must go through
  undo history).
- Freezing the UI: analysis runs on a downscaled alpha mask and a coarse token grid.

## How it works

1. **Analyse the subject** from the cut-out's alpha (downscaled to at most 256 px): bounding box,
   area, and a head estimate — the alpha-weighted centre of the top band of the silhouette, with a
   radius from that band's width. With AI tools, one SAM click at the estimate replaces it with the
   segmented head's bounds when SAM returns a plausible, compact region.
2. **Generate framings**: for head sizes of roughly 35%, 45% and 55% of the frame opening and head
   heights of 36% and 42% of the token, plus one "whole figure" framing, compute zoom and offsets
   that put the head there, horizontally centred.
3. **Find protrusions** for each framing on a 96×96 token grid: connected pieces of the subject
   outside the frame opening, with area, centroid, bounding box, elongation and whether they touch
   the opening.
4. **Pop-out variants** per framing: none; top (pieces above the automatic cutoff line); and top
   plus long, thin pieces that rise above the centre (weapons, horns, staves). Pieces in the bottom
   arc never pop out (the body is cropped there).
5. **Score** each candidate:
   - head in the upper-middle and of a pleasing size;
   - subject fills a good share of the frame opening;
   - a tasteful amount of pop-out (about 3–12% of the token area), nothing excessive;
   - penalties for subject cut by the frame on the sides (awkward arm cuts), for popped pieces not
     touching the opening (floating fragments) and for popped parts cut by the token edge.
6. **Present**: apply the best, show the top four distinct candidates as thumbnails.
7. **SAM parts (AI tools)**: for the applied candidate, each popped piece gets one SAM click at its
   tip; the returned part mask is added so the whole part pops out.

## Decided

- Heuristics + existing SlimSAM only; no new models.
- Token mode only; candidates are thumbnails under the preview.
- Pure analysis and scoring live in `scripts/auto-compose.js` with unit tests on synthetic
  silhouettes; DOM, SAM and rendering stay in `scripts/token-creator.js`.

## Left to the builder

- Exact score weights, tuned against synthetic shapes and real art.
- Thumbnail styling, consistent with the creator's cards and segmented controls.
