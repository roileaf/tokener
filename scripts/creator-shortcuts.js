export const MIN_BRUSH_SIZE = 4;
export const MAX_BRUSH_SIZE = 160;
export const MIN_VIEW_SCALE = 0.4;
export const MAX_VIEW_SCALE = 4;
const VIEW_SCALE_STEP = 1.25;

const KEY_COMMANDS = {
  b: 'tool-paint',
  e: 'tool-erase',
  w: 'tool-select',
  q: 'tool-cut',
  r: 'tool-restore',
  g: 'tool-wand',
  p: 'tool-pin',
  v: 'tool-move',
  escape: 'tool-move',
  x: 'swap',
  a: 'auto',
  '[': 'brush-smaller',
  ']': 'brush-larger',
  '-': 'view-out',
  _: 'view-out',
  '=': 'view-in',
  '+': 'view-in',
  0: 'view-reset',
};

/** Maps a keydown event to a Token Creator mask command, or null when the key is not a shortcut. */
export function getMaskShortcut({ key, ctrlKey, metaKey, shiftKey, altKey } = {}) {
  const lower = String(key ?? '').toLowerCase();
  if (ctrlKey || metaKey) {
    if (lower === 'z') return shiftKey ? 'redo' : 'undo';
    if (lower === 'y') return 'redo';
    return null;
  }
  if (altKey) return null;
  return KEY_COMMANDS[lower] ?? null;
}

/**
 * Decides what a drag on the preview does: Shift paints and Alt erases from any tool, the right
 * button uses the opposite of the active brush, and a plain drag uses the active brush or pans.
 */
const CLEANUP_TOOLS = ['cut', 'restore', 'wand'];

/**
 * The toolbar button that shows a tool as active. Paint and erase are the two modes of the one
 * pop-out brush (E or X starts it in erase mode), so both light up the brush button.
 */
export function getToolButton(tool) {
  if (!tool) return 'move';
  return tool === 'erase' ? 'paint' : tool;
}

/** Background cleanup tools edit the cut-out itself; the others edit the pop-out mask. */
export function isCleanupTool(tool) {
  return CLEANUP_TOOLS.includes(tool);
}

export function getStrokeMode({ tool = null, button = 0, shiftKey = false, altKey = false } = {}) {
  if (tool === 'cut' || tool === 'restore') {
    if (altKey || button === 2) return tool === 'cut' ? 'restore' : 'cut';
    return tool;
  }
  if (tool === 'wand') return null;
  if (altKey) return 'erase';
  if (shiftKey) return 'paint';
  if (button === 2) return tool === 'erase' ? 'paint' : 'erase';
  return tool === 'paint' || tool === 'erase' ? tool : null;
}

export function stepViewScale(scale, direction) {
  const current = Number(scale) || 1;
  const sign = Math.sign(Number(direction) || 0);
  const next =
    sign > 0 ? current * VIEW_SCALE_STEP : sign < 0 ? current / VIEW_SCALE_STEP : current;
  const rounded = Math.round(next * 100) / 100;
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, rounded));
}

export function stepBrushSize(size, direction) {
  const current = Number(size) || MIN_BRUSH_SIZE;
  const step = current < 20 ? 2 : current < 60 ? 4 : 8;
  const next = current + Math.sign(Number(direction) || 0) * step;
  return Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, next));
}
