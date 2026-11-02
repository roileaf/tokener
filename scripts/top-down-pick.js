// Picking the creature for a top-down token: the picture is shown whole and a selection is made
// on it with Segment Anything clicks, a magic wand and a brush. Only the selection goes to the
// generator.

export const PICK_TOOLS = ['click', 'wand', 'brush'];

/**
 * How a press changes the selection: right-click or Alt removes, Shift-click adds, and a plain
 * click starts over. The wand and the brush always add to what is there.
 */
export function getPickMode({ tool, button = 0, altKey = false, shiftKey = false } = {}) {
  if (button === 2 || altKey) return 'remove';
  if (tool === 'click' && !shiftKey) return 'replace';
  return 'add';
}
