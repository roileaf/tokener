import {
  getSequencerEntryName,
  resolveSequencerFile,
  searchSequencerEntries,
} from './sequencer-clips.js';
import { localize } from './utils.js';

// Picks an animation from the user's own Sequencer database (JB2A and any other module that
// registers effects there) for the Token Creator, with a search and a looping preview.

/** The Sequencer database, when Sequencer is active. */
function getDatabase() {
  return globalThis.Sequencer?.Database ?? null;
}

/** Every public catalog path (e.g. 'jb2a.breath_weapons.fire.cone.orange.02'); empty without Sequencer. */
export function getSequencerCatalog() {
  const paths = getDatabase()?.publicFlattenedSimpleEntries;
  return Array.isArray(paths) ? paths : [];
}

export function hasSequencerCatalog() {
  return getSequencerCatalog().length > 0;
}

/** The file a catalog path plays, or null. */
export function getSequencerFile(path) {
  try {
    return resolveSequencerFile(getDatabase()?.getEntry?.(path, { softFail: true }));
  } catch {
    return null;
  }
}

/**
 * Opens the catalog picker. Resolves to `{ path, file }` for the chosen animation, or null when
 * the dialog is closed without one.
 */
export async function openSequencerPicker({ path = '' } = {}) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.input || !hasSequencerCatalog()) return null;
  const chosen = await DialogV2.input({
    window: {
      icon: 'fas fa-film',
      title: localize('Creator.Animate.Sequencer.PickerTitle', 'Choose an animation'),
    },
    position: { width: 720 },
    content: renderPickerContent(path),
    render: (_event, dialog) => activatePicker(dialog),
    ok: {
      label: localize('Creator.Animate.Sequencer.Use', 'Use animation'),
      icon: 'fas fa-check',
      callback: (_event, button) => button.form?.elements?.sequencerPath?.value || null,
    },
    rejectClose: false,
  });
  if (typeof chosen !== 'string' || !chosen) return null;
  const file = getSequencerFile(chosen);
  return file ? { path: chosen, file } : null;
}

function renderPickerContent(path) {
  const placeholder = localize(
    'Creator.Animate.Sequencer.Search',
    'Search, e.g. fire breath, flames orange, smoke',
  );
  return `<div class="pf2e-tokener-sequencer-picker">
  <input type="search" name="sequencerSearch" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(path)}" autofocus />
  <input type="hidden" name="sequencerPath" value="${escapeHtml(path)}" />
  <div class="pf2e-tokener-sequencer-body">
    <ul class="pf2e-tokener-sequencer-results" data-sequencer-results></ul>
    <div class="pf2e-tokener-sequencer-preview">
      <video data-sequencer-preview muted loop autoplay playsinline></video>
      <p data-sequencer-name></p>
    </div>
  </div>
  <p class="hint" data-sequencer-count></p>
</div>`;
}

function activatePicker(dialog) {
  const root = dialog?.element;
  const picker = root?.querySelector?.('.pf2e-tokener-sequencer-picker');
  if (!picker || picker.dataset.bound) return;
  picker.dataset.bound = 'true';
  const search = picker.querySelector('[name="sequencerSearch"]');
  const chosen = picker.querySelector('[name="sequencerPath"]');
  const results = picker.querySelector('[data-sequencer-results]');
  const preview = picker.querySelector('[data-sequencer-preview]');
  const name = picker.querySelector('[data-sequencer-name]');
  const count = picker.querySelector('[data-sequencer-count]');
  const catalog = getSequencerCatalog();

  const choose = (path) => {
    chosen.value = path;
    name.textContent = path;
    const file = getSequencerFile(path);
    if (file) preview.src = file;
    for (const item of results.querySelectorAll('[data-sequencer-path]'))
      item.setAttribute('aria-pressed', String(item.dataset.sequencerPath === path));
  };
  const list = () => {
    const found = searchSequencerEntries(catalog, search.value);
    results.replaceChildren(
      ...found.map((path) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sequencerPath = path;
        button.setAttribute('aria-pressed', String(path === chosen.value));
        button.textContent = getSequencerEntryName(path);
        button.title = path;
        item.append(button);
        return item;
      }),
    );
    count.textContent = localize(
      'Creator.Animate.Sequencer.Count',
      '{shown} shown of {total} animations',
    )
      .replace('{shown}', String(found.length))
      .replace('{total}', String(catalog.length));
  };
  let pending = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(list);
  });
  results.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-sequencer-path]');
    if (button) choose(button.dataset.sequencerPath);
  });
  results.addEventListener('dblclick', (event) => {
    if (!event.target?.closest?.('[data-sequencer-path]')) return;
    root.querySelector('button[data-action="ok"]')?.click();
  });
  list();
  if (chosen.value) choose(chosen.value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
