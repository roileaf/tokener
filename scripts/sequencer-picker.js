import {
  getClipThumbnails,
  getSequencerCategories,
  getSequencerEntryName,
  resolveSequencerFile,
  searchSequencerEntries,
} from './sequencer-clips.js';
import { localize } from './utils.js';

// Picks an animation from the user's own Sequencer database (JB2A and any other module that
// registers effects there) for the Token Creator: browse by category or search, as a grid of
// thumbnails that play on hover, with a large preview of the chosen one.

/** Cards shown at first and added by each "Show more". */
const PAGE_SIZE = 60;

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
      resizable: true,
    },
    position: { width: 1080, height: 680 },
    classes: ['pf2e-tokener-sequencer-dialog'],
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
  const all = localize('Creator.Animate.Sequencer.All', 'All animations');
  const categories = getSequencerCategories(getSequencerCatalog())
    .map(
      ({ key, label, count }) =>
        `<li><button type="button" data-sequencer-category="${escapeHtml(key)}" title="${escapeHtml(key)}"><span>${escapeHtml(label)}</span><small>${count}</small></button></li>`,
    )
    .join('');
  return `<div class="pf2e-tokener-sequencer-picker">
  <nav class="pf2e-tokener-sequencer-categories">
    <ul>
      <li><button type="button" data-sequencer-category="" aria-pressed="true"><span>${escapeHtml(all)}</span><small>${getSequencerCatalog().length}</small></button></li>
      ${categories}
    </ul>
  </nav>
  <section class="pf2e-tokener-sequencer-main">
    <input type="search" name="sequencerSearch" placeholder="${escapeHtml(placeholder)}" autofocus />
    <input type="hidden" name="sequencerPath" value="${escapeHtml(path)}" />
    <div class="pf2e-tokener-sequencer-grid" data-sequencer-results></div>
    <p class="hint" data-sequencer-count></p>
  </section>
  <aside class="pf2e-tokener-sequencer-preview">
    <video data-sequencer-preview muted loop autoplay playsinline></video>
    <strong data-sequencer-name></strong>
    <small data-sequencer-file></small>
  </aside>
</div>`;
}

function activatePicker(dialog) {
  const root = dialog?.element;
  const picker = root?.querySelector?.('.pf2e-tokener-sequencer-picker');
  if (!picker || picker.dataset.bound) return;
  picker.dataset.bound = 'true';
  const doc = picker.ownerDocument;
  const search = picker.querySelector('[name="sequencerSearch"]');
  const chosen = picker.querySelector('[name="sequencerPath"]');
  const grid = picker.querySelector('[data-sequencer-results]');
  const preview = picker.querySelector('[data-sequencer-preview]');
  const name = picker.querySelector('[data-sequencer-name]');
  const fileLabel = picker.querySelector('[data-sequencer-file]');
  const count = picker.querySelector('[data-sequencer-count]');
  const catalog = getSequencerCatalog();
  let category = '';
  let found = [];
  let shown = 0;

  const choose = (path) => {
    chosen.value = path;
    name.textContent = getSequencerEntryName(path);
    fileLabel.textContent = path;
    const file = getSequencerFile(path);
    if (file) preview.src = file;
    for (const card of grid.querySelectorAll('[data-sequencer-path]'))
      card.setAttribute('aria-pressed', String(card.dataset.sequencerPath === path));
  };

  const makeCard = (path) => {
    const card = doc.createElement('button');
    card.type = 'button';
    card.className = 'pf2e-tokener-sequencer-card';
    card.dataset.sequencerPath = path;
    card.title = path;
    card.setAttribute('aria-pressed', String(path === chosen.value));
    const file = getSequencerFile(path);
    const thumbnails = getClipThumbnails(file);
    const frame = doc.createElement('span');
    frame.className = 'pf2e-tokener-sequencer-thumb';
    // Each likely JB2A thumbnail in turn, then the video's own frame half a second in.
    const showVideo = () => {
      if (!file) return;
      const video = doc.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = `${file}#t=0.5`;
      frame.replaceChildren(video);
    };
    if (thumbnails.length) {
      const image = doc.createElement('img');
      image.loading = 'lazy';
      image.alt = '';
      let attempt = 0;
      image.addEventListener('error', () => {
        attempt += 1;
        if (attempt < thumbnails.length) image.src = thumbnails[attempt];
        else showVideo();
      });
      image.src = thumbnails[0];
      frame.append(image);
    } else showVideo();
    const label = doc.createElement('span');
    label.className = 'pf2e-tokener-sequencer-label';
    label.textContent = getSequencerEntryName(path);
    card.append(frame, label);
    return card;
  };

  const showMore = () => {
    const next = found.slice(shown, shown + PAGE_SIZE);
    grid.querySelector('[data-sequencer-more]')?.remove();
    grid.append(...next.map(makeCard));
    shown += next.length;
    if (shown < found.length) {
      const more = doc.createElement('button');
      more.type = 'button';
      more.dataset.sequencerMore = '';
      more.className = 'pf2e-tokener-sequencer-more';
      more.textContent = localize('Creator.Animate.Sequencer.More', 'Show more');
      grid.append(more);
    }
    count.textContent = localize(
      'Creator.Animate.Sequencer.Count',
      '{shown} shown of {total} animations',
    )
      .replace('{shown}', String(shown))
      .replace('{total}', String(found.length));
  };

  const list = () => {
    const pool = category ? catalog.filter((path) => path.startsWith(`${category}.`)) : catalog;
    found = searchSequencerEntries(pool, search.value, Infinity);
    shown = 0;
    grid.replaceChildren();
    grid.scrollTop = 0;
    showMore();
  };

  const pickCategory = (button) => {
    category = button.dataset.sequencerCategory;
    for (const item of picker.querySelectorAll('[data-sequencer-category]'))
      item.setAttribute('aria-pressed', String(item === button));
  };

  let pending = 0;
  search.addEventListener('input', () => {
    clearTimeout(pending);
    pending = setTimeout(list, 150);
  });
  picker.querySelector('.pf2e-tokener-sequencer-categories').addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-sequencer-category]');
    if (!button) return;
    pickCategory(button);
    list();
  });
  grid.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-sequencer-more]')) {
      showMore();
      return;
    }
    const card = event.target?.closest?.('[data-sequencer-path]');
    if (card) choose(card.dataset.sequencerPath);
  });
  grid.addEventListener('dblclick', (event) => {
    if (!event.target?.closest?.('[data-sequencer-path]')) return;
    root.querySelector('button[data-action="ok"]')?.click();
  });
  // A card plays its clip while the pointer is over it.
  grid.addEventListener('mouseover', (event) => {
    const card = event.target?.closest?.('[data-sequencer-path]');
    if (!card || card.querySelector('video[data-hover]')) return;
    const file = getSequencerFile(card.dataset.sequencerPath);
    if (!file) return;
    const video = doc.createElement('video');
    video.dataset.hover = '';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.src = file;
    card.querySelector('.pf2e-tokener-sequencer-thumb')?.append(video);
    card.addEventListener(
      'mouseleave',
      () => {
        video.removeAttribute('src');
        video.load();
        video.remove();
      },
      { once: true },
    );
  });

  // Reopened on a clip: start in its category.
  if (chosen.value) {
    const current = getSequencerCategories([chosen.value])[0]?.key ?? '';
    const button = [...picker.querySelectorAll('[data-sequencer-category]')].find(
      (item) => item.dataset.sequencerCategory === current,
    );
    if (button) {
      pickCategory(button);
      button.scrollIntoView?.({ block: 'center' });
    }
  }
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
