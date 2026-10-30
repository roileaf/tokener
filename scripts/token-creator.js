import { buildAutoRig } from './auto-animate.js';
import {
  composeCandidates,
  DEFAULT_COMPOSE_GRID,
  expandPopOutMask,
  getAlphaGrid,
  hasBackgroundLeft,
  pickComposeOptions,
} from './auto-compose.js';
import {
  areAiToolsEnabled,
  canCacheModels,
  createDownloadTracker,
  createSamSelector,
  loadTransformers,
  registerAiToolsSetting,
} from './ai-tools.js';
import { loadComposeRankingModel, rerankComposeCandidates } from './compose-ai-ranking.js';
import {
  DEFAULT_BACKGROUND_FEATHER,
  DEFAULT_BACKGROUND_TOLERANCE,
  getFillRegion,
  removeImageBackground,
} from './background-removal.js';
import {
  CREATED_TOKEN_FOLDER_SETTING_KEY,
  MODULE_ID,
  TOKEN_CREATOR_DEFAULTS_SETTING_KEY,
} from './constants.js';
import {
  getMaskShortcut,
  getStrokeMode,
  getToolButton,
  isCleanupTool,
  stepBrushSize,
  stepViewScale,
} from './creator-shortcuts.js';
import {
  ANIMATION_PRESETS,
  applyPreset,
  createPin,
  getFrameTimes,
  hasMotion,
  KEYFRAME_MERGE,
  loopDistance,
  normalizeAnimation,
  removeKeyframe,
  samplePinOffset,
} from './animation.js';
import {
  createEffect,
  EFFECT_SUPPORTS_REGION,
  EFFECT_TYPES,
  hasPaintedRegion,
  isSafeEffectKey,
  normalizeEffects,
  PARTICLE_COLORS,
  PARTICLE_KINDS,
} from './animation-effects.js';
import { applyCreatedTokenCandidate, getCreatedTokenApplyActions } from './picker-app.js';
import {
  canPlayWithTool,
  clearEffectCaches,
  getAnimatedOutputSize,
  getAnimatedSavePlan,
  getPinHitRadius,
  ensurePinArm,
  getKeyframeAt,
  getKeyframeMarkerTimes,
  getKeyframeTime,
  getPinToolEscapeAction,
  getPinPreviewPoints,
  getPinDragMode,
  getPresetAmplitude,
  getPresetTargets,
  getRotationArm,
  hasActiveMotion,
  isPastDragDeadZone,
  isPresetAvailable,
  renderAnimationFrame,
  resetAnimationForNewSource,
  shouldBendPreview,
  toggleSelection,
  updateKeyframeAt,
} from './token-animation.js';
import { encodeAlphaWebm, probeAnimationSupport } from './webm-alpha.js';
import { encodeAnimatedWebp } from './webp-anim.js';
import {
  buildProjectFileName,
  parseProject,
  serializeProject,
  shouldLoadProject,
} from './creator-project.js';
import {
  applyFlip,
  flipCanvas,
  flipPins,
  flipView,
  normalizeFlip,
  toggleFlip,
} from './image-flip.js';
import { registerCreatedTokenSubjectPath } from './ring-video.js';
import {
  colorizeRingBackground,
  colorizeRingFrame,
  measureRingInnerEdge,
  resolveRingColor,
  selectRingFrame,
} from './ring-preview.js';
import {
  buildCreatedTokenCandidate,
  buildCreatedTokenFileName,
  DEFAULT_RING_SUBJECT_RADIUS,
  applyCutoutTouchUps,
  drawPortrait,
  drawRingSubject,
  drawTokenFrame,
  getPortraitSavePlan,
  clipOutsideOpening,
  getAutoPopOutRect,
  getOpeningInImage,
  getCreatedTokenFolder,
  getPortraitAspectRatio,
  getPortraitRect,
  getPreviewViewport,
  getRectFrameLayout,
  isPortraitUnchanged,
  PORTRAIT_ASPECTS,
  PORTRAIT_BACKGROUNDS,
  getRingGeometry,
  getRingScale,
  getTokenFrameLayout,
  previewPointToImage,
  viewportPointToToken,
} from './token-composer.js';
import { clamp, getDocumentActor, localize, normalizeHudElement, numberOr } from './utils.js';

const CREATOR_TEMPLATE = 'modules/pf2e-tokener/templates/token-creator.hbs';
const WORKING_MAX_SIZE = 1024;
/** Stable stand-in for missing effect regions, so the preview bend cache key can match. */
const EMPTY_REGIONS = Object.freeze({});
const PREVIEW_SIZE = 480;
// Painted border widths are expressed in pixels of a 320px token so saved tokens keep the same
// proportions no matter how large the editor preview is.
const BORDER_REFERENCE_SIZE = 320;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const OUTPUT_SIZES = [256, 400, 512, 1024];
const BACKGROUND_MODES = ['auto', 'ai', 'none'];
const AI_BACKGROUND_MODES = ['ai'];
const FRAME_STYLES = ['painted', 'ring'];
const EDIT_TARGETS = [
  { value: 'token', icon: 'fas fa-circle-user' },
  { value: 'portrait', icon: 'fas fa-image-portrait' },
];
const AI_MODEL_ID = 'Xenova/modnet';
const DEFAULT_BRUSH_SIZE = 24;
const MASK_GHOST_ALPHA = 0.38;
const MASK_TINT_ALPHA = 0.18;
const MASK_HIGHLIGHT_COLOR = '#ffd166';
const MASK_OUTLINE_SHADOW = 'rgba(0, 0, 0, 0.85)';
const MASK_OUTLINE_WIDTH = 1.5;
const CLEANUP_GHOST_ALPHA = 0.45;
const CLEANUP_GHOST_TINT = 'rgba(255, 70, 70, 0.35)';
const BRUSH_COLORS = {
  paint: '#d6b56d',
  erase: '#8fb9d6',
  cut: '#ff7b72',
  restore: '#7bd88f',
};
const MASK_HISTORY_LIMIT = 30;
const COMPOSE_OPTIONS = 4;
const COMPOSE_THUMBNAIL_SIZE = 104;
// Click-to-select results larger than this share of the subject are ignored by auto compose: SAM
// picked the whole character instead of a part.
const COMPOSE_MAX_PART_SHARE = 0.25;
const VIEW_CONTEXT_ALPHA = 0.28;
const PIN_RADIUS = 5;
const PIN_HIT_RADIUS = 10;
const PIN_COLOR = '#8fb9d6';
const PIN_SELECTED_COLOR = '#ffd166';
const PIN_PRIMARY_RING = 5;
// Preset button icons (Font Awesome) and the keyframe easing / loop mode choices.
const PRESET_ICONS = {
  bob: 'fa-arrows-up-down',
  sway: 'fa-arrows-left-right',
  breathe: 'fa-lungs',
  flap: 'fa-dove',
  wave: 'fa-water',
  hover: 'fa-feather',
  shiver: 'fa-wave-square',
  look: 'fa-eye',
};
const PRESET_TOOLTIPS = {
  bob: 'Bob: the selected pins rise and fall',
  sway: 'Sway: the selected pins swing side to side',
  breathe: 'Breathe: every pin swells and settles about their centre (2+ pins)',
  flap: 'Flap: the selected pins beat down together, like wings',
  wave: 'Wave: the selected pins sway one after another, in the order you selected them (2+ pins)',
  hover: 'Hover: every pin floats up and down',
  shiver: 'Shiver: the selected pins jitter quickly',
  look: 'Look: the selected pins turn left and right',
};
// Effects list: icons per type, the region brush/overlay colour and the warp strength cap
// (normalizeEffects keeps wind/wobble strength under 18 % of the noise scale, at most 40 px).
const EFFECT_ICONS = {
  wind: 'fa-wind',
  wobble: 'fa-water',
  flicker: 'fa-lightbulb',
  glow: 'fa-sun',
  particles: 'fa-fire',
};
const EFFECT_TYPE_LABELS = {
  wind: 'Wind',
  wobble: 'Wobble',
  flicker: 'Flicker',
  glow: 'Glow',
  particles: 'Particles',
};
const PARTICLE_KIND_LABELS = {
  embers: 'Embers',
  smoke: 'Smoke',
  sparkles: 'Sparkles',
  snow: 'Snow',
  drips: 'Drips',
};
const FLICKER_KIND_LABELS = { opacity: 'Fade', brightness: 'Brightness' };
const EFFECT_PARAM_LABELS = {
  strength: 'Strength',
  scale: 'Ripple size',
  amount: 'Amount',
  kind: 'Kind',
  speed: 'Flickers per loop',
  color: 'Colour',
  size: 'Size',
  pulse: 'Pulse',
  count: 'Count',
};
const MAX_WARP_STRENGTH = 40;
const WARP_STRENGTH_RATIO = 0.18;
const REGION_COLOR = '#d38fff';
const REGION_OVERLAY_ALPHA = 0.45;
const KEYFRAME_EASES = ['smooth', 'linear', 'hold'];
const ANIMATION_MODES = ['loop', 'pingpong'];
const MAX_KEYFRAME_ROTATION = 45;
const LOOP_LENGTHS = [1, 1.5, 2, 2.5, 3, 3.5, 4];
const TEXT_ENTRY_SELECTOR =
  'input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea, select, [contenteditable="true"]';

export const DEFAULT_TOKEN_CREATOR_OPTIONS = Object.freeze({
  backgroundMode: 'auto',
  frameStyle: 'painted',
  tolerance: DEFAULT_BACKGROUND_TOLERANCE,
  feather: DEFAULT_BACKGROUND_FEATHER,
  borderWidth: 10,
  borderColor: '#5c1d1d',
  fill: false,
  fillColor: '#1b1b1b',
  popOut: false,
  popOutShadow: true,
  breakoutRoom: 25,
  ringColors: false,
  ringEffects: Object.freeze({ pulse: false, gradient: false, wave: false, spectral: false }),
  ringColor: '#d4af37',
  ringBackgroundColor: '#1b1b1b',
  outputSize: 400,
  portraitAspect: 'original',
  portraitBackground: 'original',
  portraitColor: '#1b1b1b',
  animatePortrait: false,
});

const MAX_BREAKOUT_ROOM = 50;

let activeCreator = null;
let TokenCreatorApplicationClass = null;
let aiSegmenterPromise = null;
let worldRingAssets = null;

export function registerTokenCreatorSettings(settings = globalThis.game?.settings) {
  registerAiToolsSetting(settings);
  settings?.register?.(MODULE_ID, CREATED_TOKEN_FOLDER_SETTING_KEY, {
    name: localize('Settings.CreatedTokenFolder.Name', 'Created token folder'),
    hint: localize(
      'Settings.CreatedTokenFolder.Hint',
      'Data folder where the Token Creator saves new tokens. Leave empty to use worlds/<world>/tokener.',
    ),
    scope: 'world',
    config: true,
    type: String,
    default: '',
    onChange: () => syncCreatedTokenSubjectPath(),
  });
  settings?.register?.(MODULE_ID, TOKEN_CREATOR_DEFAULTS_SETTING_KEY, {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
  });
}

export function canUseTokenCreator(user = globalThis.game?.user) {
  if (!user) return false;
  if (user.isGM) return true;
  try {
    return Boolean(user.can?.('FILES_UPLOAD'));
  } catch {
    return false;
  }
}

export function normalizeTokenCreatorOptions(value = {}) {
  const defaults = DEFAULT_TOKEN_CREATOR_OPTIONS;
  const options = { ...defaults, ...(value ?? {}) };
  return {
    backgroundMode: BACKGROUND_MODES.includes(options.backgroundMode)
      ? options.backgroundMode
      : defaults.backgroundMode,
    frameStyle: FRAME_STYLES.includes(options.frameStyle)
      ? options.frameStyle
      : defaults.frameStyle,
    tolerance: clamp(Math.round(numberOr(options.tolerance, defaults.tolerance)), 1, 120),
    feather: clamp(Math.round(numberOr(options.feather, defaults.feather)), 0, 8),
    borderWidth: clamp(Math.round(numberOr(options.borderWidth, defaults.borderWidth)), 0, 60),
    borderColor: normalizeColor(options.borderColor, defaults.borderColor),
    fill: Boolean(options.fill),
    fillColor: normalizeColor(options.fillColor, defaults.fillColor),
    popOut: Boolean(options.popOut),
    popOutShadow: Boolean(options.popOutShadow),
    breakoutRoom: clamp(
      Math.round(numberOr(options.breakoutRoom, defaults.breakoutRoom) / 5) * 5,
      0,
      MAX_BREAKOUT_ROOM,
    ),
    ringColors: Boolean(options.ringColors),
    ringEffects: normalizeRingEffects(options.ringEffects),
    ringColor: normalizeColor(options.ringColor, defaults.ringColor),
    ringBackgroundColor: normalizeColor(options.ringBackgroundColor, defaults.ringBackgroundColor),
    outputSize: OUTPUT_SIZES.includes(Number(options.outputSize))
      ? Number(options.outputSize)
      : defaults.outputSize,
    portraitAspect: PORTRAIT_ASPECTS.includes(options.portraitAspect)
      ? options.portraitAspect
      : defaults.portraitAspect,
    portraitBackground: PORTRAIT_BACKGROUNDS.includes(options.portraitBackground)
      ? options.portraitBackground
      : defaults.portraitBackground,
    portraitColor: normalizeColor(options.portraitColor, defaults.portraitColor),
    animatePortrait: Boolean(options.animatePortrait),
  };
}

function normalizeRingEffects(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    pulse: Boolean(source.pulse),
    gradient: Boolean(source.gradient),
    wave: Boolean(source.wave),
    spectral: Boolean(source.spectral),
  };
}

export function openTokenCreator(tokenDocument, { onApplied } = {}) {
  if (!canUseTokenCreator()) return null;
  const CreatorApplication = getTokenCreatorApplicationClass();
  if (!CreatorApplication) return null;

  if (activeCreator?.rendered) {
    activeCreator.tokenDocument = tokenDocument;
    activeCreator.onApplied = onApplied;
    activeCreator.bringToFront?.();
    // Re-targeting never replaces work in progress: the saved project opens only while the
    // creator is still empty (use Open project to switch on purpose).
    const project = shouldLoadProject(tokenDocument);
    if (project && !activeCreator.workspaces.token.source && !activeCreator.busy)
      void loadCreatorProject(activeCreator, project.path);
    return activeCreator;
  }

  activeCreator = new CreatorApplication({ tokenDocument, onApplied });
  return activeCreator.render(true);
}

export function getTokenCreatorApplicationClass() {
  if (TokenCreatorApplicationClass) return TokenCreatorApplicationClass;
  const api = globalThis.foundry?.applications?.api;
  if (!api?.ApplicationV2 || !api?.HandlebarsApplicationMixin) return null;

  const HandlebarsApplication = api.HandlebarsApplicationMixin(api.ApplicationV2);
  TokenCreatorApplicationClass = class Pf2eTokenerCreatorApplication extends HandlebarsApplication {
    static DEFAULT_OPTIONS = {
      id: 'pf2e-tokener-creator',
      classes: ['pf2e-tokener-app', 'pf2e-tokener-creator-app'],
      tag: 'section',
      window: {
        icon: 'fas fa-wand-magic-sparkles',
        resizable: false,
        title: 'Token Creator',
      },
      position: {
        width: 1000,
      },
    };

    static PARTS = {
      main: {
        template: CREATOR_TEMPLATE,
      },
    };

    constructor({ tokenDocument, onApplied } = {}) {
      super();
      this.tokenDocument = tokenDocument;
      this.onApplied = onApplied;
      this.creatorOptions = normalizeTokenCreatorOptions(readCreatorDefaults());
      if (AI_BACKGROUND_MODES.includes(this.creatorOptions.backgroundMode) && !areAiToolsEnabled())
        this.creatorOptions = { ...this.creatorOptions, backgroundMode: 'auto' };
      this.view = { zoom: 1, offsetX: 0, offsetY: 0 };
      this.portraitView = { zoom: 1, offsetX: 0, offsetY: 0 };
      this.editTarget = 'token';
      // The token and portrait can each have their own image. While `portrait` is null both
      // targets share the token workspace ("Same as token").
      this.workspaces = { token: createWorkspace(), portrait: null };
      this.busy = false;
      this._cutoutToken = 0;
      this.popOutMask = null;
      this.maskTool = null;
      this.brushSize = DEFAULT_BRUSH_SIZE;
      this._maskVersion = 0;
      this._maskHistory = { undo: [], redo: [] };
      this._pointer = null;
      this.viewport = { scale: 1, panX: 0, panY: 0 };
      // Token animation: pins in source-image pixels, time as a fraction of the loop.
      this.animation = normalizeAnimation(null);
      this.animationTime = 0;
      // Selected pins in selection order; the first is the primary that keyframe controls edit.
      this.selectedPinIds = [];
      // Effect regions: source-image px canvases keyed by effect.region. One stable object; the
      // preview falls back to the frozen EMPTY_REGIONS only when it is missing.
      this.effectRegions = {};
      this.selectedEffectId = null;
      this._regionVersion = 0;
      this.animationPlaying = false;
      this._animationFrame = null;
      // WebM encoding support, probed once when the creator first renders (false until then).
      this.animationSupported = false;
      this._animationProbe = null;
      this._onPaste = (event) => void handleCreatorPaste(this, event);
      this._onKeyDown = (event) => handleCreatorKeyDown(this, event);
      this._onKeyUp = (event) => {
        if (event.key === 'Shift' || event.key === 'Alt') refreshPointerMode(this, event);
      };
    }

    get title() {
      return localize('Creator.Title', 'Token Creator');
    }

    /** The workspace being edited: the portrait's own one when separate, else the token's. */
    get workspace() {
      return this.editTarget === 'portrait' && this.workspaces.portrait
        ? this.workspaces.portrait
        : this.workspaces.token;
    }

    get source() {
      return this.workspace.source;
    }

    set source(value) {
      this.workspace.source = value;
    }

    get autoCutout() {
      return this.workspace.autoCutout;
    }

    set autoCutout(value) {
      this.workspace.autoCutout = value;
    }

    get cutout() {
      return this.workspace.cutout;
    }

    set cutout(value) {
      this.workspace.cutout = value;
    }

    get cleanup() {
      return this.workspace.cleanup;
    }

    set cleanup(value) {
      this.workspace.cleanup = value;
    }

    async _prepareContext(options) {
      const context = (await super._prepareContext?.(options)) ?? {};
      return { ...context, ...prepareCreatorContext(this) };
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      activateCreatorListeners(this);
      startAnimationSupportProbe(this);
      if (!this.source && !this._initialSourceRequested) {
        this._initialSourceRequested = true;
        // A token made in the creator reopens its saved project instead of starting over.
        const project = shouldLoadProject(this.tokenDocument);
        const portrait = getDocumentActor(this.tokenDocument)?.img;
        if (project) void loadCreatorProject(this, project.path);
        else if (portrait && !isDefaultArtwork(portrait))
          void loadCreatorSource(this, { path: portrait });
      } else {
        renderCreatorPreview(this);
      }
    }

    async _onClose(options) {
      stopAnimationPlayback(this);
      globalThis.removeEventListener?.('paste', this._onPaste);
      globalThis.removeEventListener?.('keydown', this._onKeyDown, true);
      globalThis.removeEventListener?.('keyup', this._onKeyUp, true);
      if (activeCreator === this) activeCreator = null;
      await super._onClose?.(options);
    }
  };
  return TokenCreatorApplicationClass;
}

function prepareCreatorContext(app) {
  const options = app.creatorOptions;
  const actions = getCreatedTokenApplyActions(app.tokenDocument);
  const kbd = (key) => `<kbd>${key}</kbd>`;
  return {
    options,
    previewSize: PREVIEW_SIZE,
    brushSize: app.brushSize,
    zoom: {
      min: ZOOM_MIN,
      max: ZOOM_MAX,
      value: getActiveView(app).zoom,
      label: formatZoom(getActiveView(app).zoom),
    },
    editTarget: app.editTarget,
    canFlip: canFlip(app),
    editTargets: EDIT_TARGETS.map((target) => ({
      ...target,
      label: localize(`Creator.EditTarget.${target.value}`, target.value),
      selected: app.editTarget === target.value,
    })),
    portraitImage: app.workspaces.portrait ? 'separate' : 'linked',
    portraitImageModes: ['linked', 'separate'].map((mode) => ({
      value: mode,
      label: localize(`Creator.PortraitImage.${mode}`, mode),
      selected: (app.workspaces.portrait ? 'separate' : 'linked') === mode,
    })),
    portraitAspects: PORTRAIT_ASPECTS.map((aspect) => ({
      value: aspect,
      label: localize(`Creator.PortraitAspect.${aspect}`, aspect),
      selected: options.portraitAspect === aspect,
    })),
    portraitBackgrounds: PORTRAIT_BACKGROUNDS.map((background) => ({
      value: background,
      label: localize(`Creator.PortraitBackground.${background}`, background),
      selected: options.portraitBackground === background,
    })),
    aiTools: areAiToolsEnabled(),
    backgroundModes: BACKGROUND_MODES.filter(
      (mode) => !AI_BACKGROUND_MODES.includes(mode) || areAiToolsEnabled(),
    ).map((mode) => ({
      value: mode,
      label: localize(`Creator.BackgroundModeShort.${mode}`, mode),
      tooltip: localize(`Creator.BackgroundMode.${mode}`, mode),
      selected: options.backgroundMode === mode,
    })),
    frameStyles: FRAME_STYLES.map((style) => ({
      value: style,
      label: localize(`Creator.FrameStyle.${style}`, style),
      tooltip: localize(`Creator.FrameStyleTooltip.${style}`, ''),
      selected: options.frameStyle === style,
    })),
    outputSizes: OUTPUT_SIZES.map((size) => ({
      value: size,
      label: `${size}px`,
      selected: options.outputSize === size,
    })),
    applyActions: actions,
    animation: {
      available: app.animationSupported,
      time: formatLoopPercent(app.animationTime),
      timeValue: Math.round(app.animationTime * 1000) / 10,
      lengths: LOOP_LENGTHS.map((seconds) => ({
        value: seconds,
        label: `${seconds} s`,
        selected: app.animation.duration === seconds,
      })),
      presets: ANIMATION_PRESETS.map((preset) => {
        const key = `${preset[0].toUpperCase()}${preset.slice(1)}`;
        return {
          value: preset,
          icon: PRESET_ICONS[preset],
          label: localize(`Creator.Animate.${key}`, key),
          tooltip: localize(`Creator.Animate.${key}Tooltip`, PRESET_TOOLTIPS[preset]),
        };
      }),
      modes: ANIMATION_MODES.map((mode) => ({
        value: mode,
        label:
          mode === 'loop'
            ? localize('Creator.Animate.ModeLoop', 'Loop')
            : localize('Creator.Animate.ModePingPong', 'Ping-pong'),
        tooltip:
          mode === 'loop'
            ? localize(
                'Creator.Animate.ModeLoopTooltip',
                'Play the keyframes over and over. Switching keeps the existing keyframes; presets applied afterwards are shaped for this mode.',
              )
            : localize(
                'Creator.Animate.ModePingPongTooltip',
                'Play the keyframes forward, then backward. Switching keeps the existing keyframes; presets applied afterwards are shaped for this mode.',
              ),
        selected: app.animation.mode === mode,
      })),
      eases: KEYFRAME_EASES.map((ease) => ({
        value: ease,
        label: localize(
          `Creator.Animate.Ease${ease[0].toUpperCase()}${ease.slice(1)}`,
          `${ease[0].toUpperCase()}${ease.slice(1)}`,
        ),
      })),
      rotationMax: MAX_KEYFRAME_ROTATION,
      effectTypes: EFFECT_TYPES.map((type) => ({
        value: type,
        label: getEffectTypeLabel(type),
      })),
      particleKinds: PARTICLE_KINDS.map((kind) => ({
        value: kind,
        label: getParticleKindLabel(kind),
      })),
    },
    labels: {
      animateTitle: localize('Creator.Animate.Title', 'Animate'),
      animatePlay: localize('Creator.Animate.Play', 'Play'),
      animatePause: localize('Creator.Animate.Pause', 'Pause'),
      animateAddKeyframe: localize('Creator.Animate.AddKeyframe', 'Add keyframe'),
      animateRemoveKeyframe: localize('Creator.Animate.RemoveKeyframe', 'Remove keyframe'),
      animateAuto: localize('Creator.Animate.AutoAnimate', 'Auto animate'),
      animateAutoTooltip: localize(
        'Creator.Animate.AutoAnimateTooltip',
        'Place pins on the head, chest, base and any protruding parts, with a gentle idle loop',
      ),
      animateLength: localize('Creator.Animate.Length', 'Loop length'),
      animateMode: localize('Creator.Animate.Mode', 'Playback'),
      animateEase: localize('Creator.Animate.Ease', 'Easing'),
      animateEaseTooltip: localize(
        'Creator.Animate.EaseTooltip',
        'How the selected pin moves from this keyframe to the next: smooth, steady, or holding still until it jumps',
      ),
      animateRotation: localize('Creator.Animate.Rotation', 'Rotation'),
      animateRotationTooltip: localize(
        'Creator.Animate.RotationTooltip',
        'Turns the art around the selected pin at this keyframe',
      ),
      animateHint: localize(
        'Creator.Animate.Hint',
        "Keep moves small: parts can't reveal what is behind them.",
      ),
      animateUnavailable: localize(
        'Creator.Animate.Unavailable',
        'Animated tokens need Foundry opened over https or localhost.',
      ),
      pinTooltip: localize(
        'Creator.Animate.PinTooltip',
        'Pins: click to add or select, Shift+click to add to the selection, drag to move or keyframe at the current time, right-click to remove (P)',
      ),
      effectsTitle: localize('Creator.Animate.Effects.Title', 'Effects'),
      effectsType: localize('Creator.Animate.Effects.Type', 'Effect'),
      effectsKind: localize('Creator.Animate.Effects.Kind', 'Kind'),
      effectsAdd: localize('Creator.Animate.Effects.Add', 'Add'),
      effectsAddTooltip: localize(
        'Creator.Animate.Effects.AddTooltip',
        'Add an effect of this type. Effects loop seamlessly with the pins.',
      ),
      effectsEmpty: localize(
        'Creator.Animate.Effects.Empty',
        'No effects yet: add wind, a glow, flickering or particles.',
      ),
      regionTooltip: localize(
        'Creator.Animate.Effects.RegionTooltip',
        'Effect region brush (F): drag over the art where the selected effect applies, right-drag or Alt-drag to remove',
      ),
      source: localize('Creator.Source', 'Image'),
      browse: localize('Creator.Browse', 'Browse files'),
      openProject: localize('Creator.OpenProject', 'Open project'),
      openProjectTooltip: localize(
        'Creator.OpenProjectTooltip',
        'Open a saved Token Creator project (.tokener.json) to keep editing it.',
      ),
      upload: localize('Creator.Upload', 'Upload'),
      flipHorizontal: localize('Creator.FlipHorizontal', 'Flip horizontal'),
      flipHorizontalTooltip: localize(
        'Creator.FlipHorizontalTooltip',
        'Mirror the image left to right, with its touch-ups, pop-out, effect regions and pins. In Portrait mode this flips the token too while the portrait uses the same image.',
      ),
      flipVertical: localize('Creator.FlipVertical', 'Flip vertical'),
      flipVerticalTooltip: localize(
        'Creator.FlipVerticalTooltip',
        'Mirror the image top to bottom, with its touch-ups, pop-out, effect regions and pins. In Portrait mode this flips the token too while the portrait uses the same image.',
      ),
      portrait: localize('Creator.UsePortrait', 'Use portrait'),
      dropHint: localize(
        'Creator.DropHint',
        'Drop or paste an image here. Drag to move, scroll to zoom.',
      ),
      background: localize('Creator.Background', 'Background'),
      tolerance: localize('Creator.Tolerance', 'Tolerance'),
      feather: localize('Creator.Feather', 'Edge softness'),
      aiHint: localize(
        'Creator.AiHint',
        'AI mode downloads a background removal model (~7 MB) on first use.',
      ),
      frame: localize('Creator.Frame', 'Frame'),
      borderWidth: localize('Creator.BorderWidth', 'Border width'),
      borderColor: localize('Creator.BorderColor', 'Border colour'),
      fill: localize('Creator.Fill', 'Fill background'),
      popOut: localize('Creator.PopOut', 'Pop out of frame'),
      breakoutRoom: localize('Creator.BreakoutRoom', 'Breakout room'),
      popOutShadow: localize('Creator.PopOutShadow', 'Shadow under popped parts'),
      breakoutRoomTooltip: localize(
        'Creator.BreakoutRoomTooltip',
        'Space around the frame for popped-out parts to reach past its edge. The token is scaled up in Foundry so the frame still fits the grid.',
      ),
      maskMoveTooltip: localize('Creator.MaskMoveTooltip', 'Move and zoom the art (V)'),
      maskPaintTooltip: localize(
        'Creator.MaskPaintTooltip',
        'Pop-out brush (B): drag over parts to pop them out of the frame, right-drag or Alt-drag to keep them inside',
      ),
      maskSelectTooltip: localize(
        'Creator.MaskSelectTooltip',
        'Click a part to pop it out, right-click to remove it (W). Downloads a selection model on first use.',
      ),
      maskUndoTooltip: localize('Creator.MaskUndoTooltip', 'Undo mask change (Ctrl+Z)'),
      maskRedoTooltip: localize('Creator.MaskRedoTooltip', 'Redo mask change (Ctrl+Shift+Z)'),
      maskAutoTooltip: localize(
        'Creator.MaskAutoTooltip',
        'Go back to popping out everything above the lower part of the frame (A)',
      ),
      maskClearTooltip: localize('Creator.MaskClearTooltip', 'Remove all pop-out areas.'),
      cleanupCutTooltip: localize(
        'Creator.CleanupCutTooltip',
        'Touch-up brush (Q): drag over leftovers to remove them, right-drag or Alt-drag to bring the original back',
      ),
      cleanupWandTooltip: localize(
        'Creator.CleanupWandTooltip',
        'Fill remove: click a patch of background to remove it, right-click to restore one (G)',
      ),
      cleanupReset: localize('Creator.CleanupReset', 'Reset touch-ups'),
      cleanupButton: localize('Creator.CleanupButton', 'Touch up'),
      viewOutTooltip: localize('Creator.ViewOutTooltip', 'Zoom the view out (-)'),
      viewInTooltip: localize('Creator.ViewInTooltip', 'Zoom the view in (=)'),
      viewResetTooltip: localize('Creator.ViewResetTooltip', 'Reset the view (0)'),
      viewLabel: `${Math.round(app.viewport.scale * 100)}%`,
      brushSize: localize('Creator.BrushSize', 'Brush size'),
      maskHint: localize(
        'Creator.MaskHint',
        'Only the art outside the frame can pop out, so brush strokes may cross the frame edge. With a mask tool active, outlined parts pop out and faded parts stay inside.',
      ),
      shortcutsHeading: localize('Creator.Shortcuts', 'Shortcuts'),
      shortcuts: [
        {
          keys: `${kbd('-')} ${kbd('=')} ${kbd('0')} / ${kbd('Alt')} ${localize('Creator.ShortcutWheel', 'wheel')}`,
          label: localize('Creator.ShortcutView', 'View zoom'),
        },
        {
          keys: `${kbd('Middle')} ${localize('Creator.ShortcutDrag', 'drag')}`,
          label: localize('Creator.ShortcutViewPan', 'Pan view'),
        },
        {
          keys: `${kbd('Q')} ${kbd('G')}`,
          label: localize('Creator.ShortcutCleanup', 'Touch-up brush, fill remove'),
        },
        {
          keys: `${kbd('P')}`,
          label: localize(
            'Creator.ShortcutPin',
            'Pins: click to add, drag to move or keyframe, right-click to remove',
          ),
          tokenOnly: true,
        },
        {
          keys: `${kbd('F')}`,
          label: localize(
            'Creator.ShortcutRegion',
            'Effect region brush: paint where the selected effect applies',
          ),
          tokenOnly: true,
        },
        {
          keys: `${kbd('Shift')} ${localize('Creator.ShortcutDrag', 'drag')}`,
          label: localize('Creator.ShortcutPaint', 'Pop parts out (any tool)'),
          popOut: true,
        },
        {
          keys: `${kbd('Alt')} / ${kbd('Right')} ${localize('Creator.ShortcutDrag', 'drag')}`,
          label: localize('Creator.ShortcutErase', 'Keep parts inside (any tool)'),
          popOut: true,
        },
        {
          keys: `${kbd('B')} ${kbd('V')}`,
          label: localize('Creator.ShortcutTools', 'Pop-out brush, move'),
          popOut: true,
        },
        ...(areAiToolsEnabled()
          ? [
              {
                keys: `${kbd('W')} ${localize('Creator.ShortcutClick', 'click')}`,
                label: localize('Creator.ShortcutSelect', 'Select part (right-click removes)'),
                popOut: true,
              },
            ]
          : []),
        {
          keys: `${kbd('[')} ${kbd(']')} / ${kbd('Ctrl')} ${localize('Creator.ShortcutWheel', 'wheel')}`,
          label: localize('Creator.ShortcutBrush', 'Brush size'),
          popOut: true,
        },
        {
          keys: `${kbd('Ctrl')} ${kbd('Z')} / ${kbd('Ctrl')} ${kbd('Shift')} ${kbd('Z')}`,
          label: localize('Creator.ShortcutUndo', 'Undo / redo'),
          popOut: true,
        },
      ],
      ringHint: localize(
        'Creator.RingHint',
        'Saves a transparent subject and enables the dynamic token ring. Foundry draws the ring.',
      ),
      ringEffectsTitle: localize('Creator.RingEffects.Title', 'Ring effects'),
      ringEffectsHint: localize(
        'Creator.RingEffects.Hint',
        'Foundry animates the ring itself, so these work without video.',
      ),
      ringEffectPulse: localize('Creator.RingEffects.Pulse', 'Pulse'),
      ringEffectGradient: localize('Creator.RingEffects.Gradient', 'Gradient'),
      ringEffectWave: localize('Creator.RingEffects.Wave', 'Wave'),
      ringEffectSpectral: localize('Creator.RingEffects.Spectral', 'Spectral'),
      ringColors: localize('Creator.RingColors', 'Set ring colours'),
      ringColor: localize('Creator.RingColor', 'Ring'),
      ringBackgroundColor: localize('Creator.RingBackgroundColor', 'Background'),
      zoom: localize('Creator.Zoom', 'Zoom'),
      resetView: localize('Creator.ResetView', 'Reset position'),
      output: localize('Creator.Output', 'Output'),
      portraitHeading: localize('Creator.PortraitHeading', 'Portrait'),
      portraitImage: localize('Creator.PortraitImageLabel', 'Image'),
      portraitSeparateHint: localize(
        'Creator.PortraitSeparateHint',
        'Loading an image here changes the portrait only.',
      ),
      fromPortrait: localize('Creator.FromPortrait', 'From portrait'),
      autoCompose: localize('Creator.AutoCompose', 'Auto compose'),
      autoComposeTooltip: localize(
        'Creator.AutoComposeTooltip',
        'Frame the art and choose what pops out automatically, then pick from a few alternatives.',
      ),
      fromPortraitTooltip: localize(
        'Creator.FromPortraitTooltip',
        'Use the edited portrait as a new token image to frame and play with. The portrait keeps its own image.',
      ),
      portraitAspect: localize('Creator.PortraitAspectLabel', 'Shape'),
      portraitBackground: localize('Creator.PortraitBackgroundLabel', 'Background'),
      animatePortrait: localize('Creator.AnimatePortrait', 'Animate portrait'),
      animatePortraitTooltip: localize(
        'Creator.AnimatePortraitTooltip',
        'Save the portrait as an animated WebP that plays the token animation (15 fps, up to 512 px).',
      ),
      portraitHint: localize(
        'Creator.PortraitHint',
        'Actor, Portrait and Both save this portrait. Left untouched, the original image is used.',
      ),
      save: localize('Creator.SaveOnly', 'Save only'),
    },
  };
}

function activateCreatorListeners(app) {
  const root = normalizeHudElement(app.parts?.main) ?? normalizeHudElement(app.element);
  if (!root || root.dataset.pf2eTokenerCreatorBound) return;
  root.dataset.pf2eTokenerCreatorBound = 'true';

  globalThis.removeEventListener?.('paste', app._onPaste);
  globalThis.addEventListener?.('paste', app._onPaste);
  globalThis.removeEventListener?.('keydown', app._onKeyDown, true);
  globalThis.addEventListener?.('keydown', app._onKeyDown, true);
  globalThis.removeEventListener?.('keyup', app._onKeyUp, true);
  globalThis.addEventListener?.('keyup', app._onKeyUp, true);
  root.addEventListener('input', (event) => handleCreatorInput(app, event));
  root.addEventListener('change', (event) => void handleCreatorChange(app, event));
  root.addEventListener('click', (event) => void handleCreatorClick(app, event));

  const canvas = root.querySelector('.pf2e-tokener-creator-preview');
  if (canvas) bindPreviewInteractions(app, canvas);
  syncMaskControls(app);
  syncAnimationControls(app);
}

function bindPreviewInteractions(app, canvas) {
  let drag = null;
  const updatePointer = (event) => {
    app._pointer = {
      ...getTokenPoint(app, canvas, event),
      mode: getPointerMode(app, event),
    };
  };

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (!app.source) return;
    canvas.focus?.({ preventScroll: true });
    if (event.button === 1) {
      event.preventDefault();
      drag = {
        view: true,
        x: event.clientX,
        y: event.clientY,
        panX: app.viewport.panX,
        panY: app.viewport.panY,
      };
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (app.maskTool === 'pin') {
      event.preventDefault();
      if (!canEditPins(app)) return;
      drag = startPinDrag(app, getTokenPoint(app, canvas, event), event.button, event.shiftKey);
      if (drag) {
        drag.press = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture?.(event.pointerId);
      }
      return;
    }
    if (app.maskTool === 'region') {
      event.preventDefault();
      const key = startRegionStroke(app);
      if (!key) return;
      const mode = getStrokeMode({
        tool: 'region',
        button: event.button,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      const point = getTokenPoint(app, canvas, event);
      drag = { mode, region: key, last: point };
      paintEffectRegion(app, key, point, point, mode);
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (isCleanupTool(app.maskTool) && app.cutout) {
      event.preventDefault();
      const point = getTokenPoint(app, canvas, event);
      if (app.maskTool === 'wand') {
        fillCleanup(app, point, event.button === 2 || event.altKey ? 'restore' : 'cut');
        return;
      }
      const mode = getStrokeMode({
        tool: app.maskTool,
        button: event.button,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      pushMaskHistory(app, 'cleanup');
      drag = { mode, cleanup: true, last: point };
      paintCleanup(app, point, point, mode);
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (app.maskTool === 'select' && canMask(app) && !event.shiftKey) {
      event.preventDefault();
      void selectPopOutPart(app, getTokenPoint(app, canvas, event), {
        remove: event.button === 2 || event.altKey,
      });
      return;
    }
    const mode = canMask(app)
      ? getStrokeMode({
          tool: app.maskTool,
          button: event.button,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
        })
      : null;
    if (mode) {
      event.preventDefault();
      stopAnimationPlayback(app);
      pushMaskHistory(app);
      const point = getTokenPoint(app, canvas, event);
      drag = { mode, last: point };
      paintPopOutMask(app, point, point, mode);
    } else if (event.button === 0) {
      const view = getActiveView(app);
      drag = {
        x: event.clientX,
        y: event.clientY,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      };
    } else {
      return;
    }
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    updatePointer(event);
    if (!drag) {
      syncBrushCursor(app);
      renderCreatorPreview(app);
      return;
    }
    if (drag.view) {
      const ratio = canvas.width / (canvas.clientWidth || canvas.width);
      app.viewport.panX = drag.panX + (event.clientX - drag.x) * ratio;
      app.viewport.panY = drag.panY + (event.clientY - drag.y) * ratio;
      renderCreatorPreview(app);
      return;
    }
    if (drag.pinId) {
      // A small tremor on a press is still a click: it neither keyframes nor keeps the selection.
      if (!drag.moved && !isPastDragDeadZone(drag.press, { x: event.clientX, y: event.clientY }))
        return;
      dragPin(app, drag, getTokenPoint(app, canvas, event));
      return;
    }
    if (drag.mode) {
      const point = getTokenPoint(app, canvas, event);
      if (drag.cleanup) paintCleanup(app, drag.last, point, drag.mode);
      else if (drag.region) paintEffectRegion(app, drag.region, drag.last, point, drag.mode);
      else paintPopOutMask(app, drag.last, point, drag.mode);
      drag.last = point;
      return;
    }
    const ratio = canvas.width / (canvas.clientWidth || canvas.width) / app.viewport.scale;
    const frame = getEditFrameSize(app, canvas.width);
    const view = getActiveView(app);
    view.offsetX = drag.offsetX + ((event.clientX - drag.x) * ratio) / frame.width;
    view.offsetY = drag.offsetY + ((event.clientY - drag.y) * ratio) / frame.height;
    renderCreatorPreview(app);
  });
  const endDrag = () => {
    const wasPin = Boolean(drag?.pinId);
    if (wasPin && drag.narrow && !drag.moved) {
      app.selectedPinIds = [drag.pinId];
      renderCreatorPreview(app);
    }
    if (drag?.region) finishRegionStroke(app);
    drag = null;
    syncMaskControls(app);
    if (wasPin) syncAnimationControls(app);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    app._pointer = null;
    syncBrushCursor(app);
    renderCreatorPreview(app);
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!app.source) return;
      event.preventDefault();
      if (event.altKey) {
        setViewScale(app, stepViewScale(app.viewport.scale, event.deltaY < 0 ? 1 : -1));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (canMask(app) || app.maskTool === 'region')) {
        setBrushSize(app, stepBrushSize(app.brushSize, event.deltaY < 0 ? 1 : -1));
        return;
      }
      setCreatorZoom(app, app.view.zoom * (event.deltaY < 0 ? 1.05 : 1 / 1.05));
    },
    { passive: false },
  );
  canvas.addEventListener('dragover', (event) => event.preventDefault());
  canvas.addEventListener('drop', (event) => void handleCreatorDrop(app, event));
}

function handleCreatorKeyDown(app, event) {
  if (!app.rendered || !isCreatorKeyboardTarget(app, event)) return;
  const command = getMaskShortcut(event);
  if (!command) {
    if (event.key === 'Shift' || event.key === 'Alt') refreshPointerMode(app, event);
    return;
  }
  if (command === 'tool-move' && event.key === 'Escape' && !app.maskTool) return;
  if (!app.cutout) return;

  event.preventDefault();
  event.stopPropagation();
  switch (command) {
    case 'tool-paint':
      selectMaskTool(app, 'paint');
      return;
    case 'tool-erase':
      selectMaskTool(app, 'erase');
      return;
    case 'tool-select':
      if (areAiToolsEnabled()) selectMaskTool(app, 'select');
      return;
    case 'tool-cut':
    case 'tool-restore':
    case 'tool-wand':
      selectMaskTool(app, command.replace('tool-', ''));
      return;
    case 'tool-move':
      if (
        event.key === 'Escape' &&
        getPinToolEscapeAction({
          maskTool: app.maskTool,
          selectedCount: app.selectedPinIds.length,
        }) === 'clear-selection'
      ) {
        app.selectedPinIds = [];
        syncAnimationControls(app);
        renderCreatorPreview(app);
        return;
      }
      setMaskTool(app, null);
      return;
    case 'tool-pin':
      selectPinTool(app);
      return;
    case 'tool-region':
      selectRegionTool(app);
      return;
    case 'swap':
      if (app.maskTool === 'region') return;
      if (isCleanupTool(app.maskTool))
        selectMaskTool(app, app.maskTool === 'cut' ? 'restore' : 'cut');
      else selectMaskTool(app, app.maskTool === 'paint' ? 'erase' : 'paint');
      return;
    case 'auto':
      resetPopOutMask(app);
      return;
    case 'brush-smaller':
    case 'brush-larger':
      setBrushSize(app, stepBrushSize(app.brushSize, command === 'brush-larger' ? 1 : -1));
      return;
    case 'undo':
      undoMask(app);
      return;
    case 'redo':
      redoMask(app);
      return;
    case 'view-in':
    case 'view-out':
      setViewScale(app, stepViewScale(app.viewport.scale, command === 'view-in' ? 1 : -1));
      return;
    case 'view-reset':
      resetViewport(app);
      return;
  }
}

function isCreatorKeyboardTarget(app, event) {
  const root = getCreatorRoot(app);
  if (!root) return false;
  if (event.target?.closest?.(TEXT_ENTRY_SELECTOR)) return false;
  const active = globalThis.document?.activeElement;
  if (active && root.contains(active)) return true;
  return Boolean(app._pointer);
}

function refreshPointerMode(app, event) {
  if (!app._pointer) return;
  app._pointer.mode = getPointerMode(app, event);
  syncBrushCursor(app);
  renderCreatorPreview(app);
}

export function handleCreatorInput(app, event) {
  const target = event.target;
  const name = target?.name;
  if (target?.dataset?.effectParam) {
    updateEffectParam(app, target);
    return;
  }
  if (name === 'zoom') {
    setCreatorZoom(app, Number(target.value));
    return;
  }
  if (name === 'brushSize') {
    setBrushSize(app, Number(target.value));
    return;
  }
  if (name === 'animationTime') {
    stopAnimationPlayback(app);
    setAnimationTime(app, Number(target.value) / 100);
    return;
  }
  if (name === 'animationRotation') {
    const degrees = Math.max(
      -MAX_KEYFRAME_ROTATION,
      Math.min(MAX_KEYFRAME_ROTATION, Number(target.value) || 0),
    );
    setPrimaryKeyframe(app, { rot: (degrees * Math.PI) / 180 });
    return;
  }
  if (!getCreatorOptionKey(name, app.creatorOptions)) return;

  updateCreatorOption(app, target);
  updateValueLabel(target);
  if (name === 'tolerance' || name === 'feather') scheduleCutout(app);
  else renderCreatorPreview(app);
}

export async function handleCreatorChange(app, event) {
  const target = event.target;
  if (target?.name === 'upload') {
    const file = target.files?.[0];
    target.value = '';
    if (file) await loadCreatorSource(app, { file });
    return;
  }
  if (target?.name === 'editTarget') {
    setEditTarget(app, target.value);
    return;
  }
  if (target?.name === 'portraitImage') {
    setPortraitImageMode(app, target.value);
    return;
  }
  if (target?.name === 'animationDuration') {
    app.animation = normalizeAnimation({ ...app.animation, duration: Number(target.value) });
    syncAnimationControls(app);
    return;
  }
  if (target?.name === 'animationMode') {
    if (!ANIMATION_MODES.includes(target.value)) return;
    app.animation = normalizeAnimation({ ...app.animation, mode: target.value });
    syncAnimationControls(app);
    renderCreatorPreview(app);
    return;
  }
  if (target?.name === 'effectType') {
    syncEffectControls(app);
    return;
  }
  if (target?.name === 'effectRegion') {
    setEffectRegionMode(app, target.value === 'painted');
    return;
  }
  if (target?.dataset?.effectParam) return;
  if (target?.name === 'animationEase') {
    if (KEYFRAME_EASES.includes(target.value)) setPrimaryKeyframe(app, { ease: target.value });
    return;
  }
  if (!getCreatorOptionKey(target?.name, app.creatorOptions)) return;
  updateCreatorOption(app, target);
  saveCreatorDefaults(app.creatorOptions);
  if (target.name === 'portraitBackground') syncPortraitControls(app);
  if (target.name === 'frameStyle') {
    syncFrameControls(app);
    renderCreatorPreview(app);
  }
  if (
    target.name === 'popOut' ||
    target.name === 'breakoutRoom' ||
    target.name === 'popOutShadow'
  ) {
    if (!app.creatorOptions.popOut) setMaskTool(app, null);
    syncFrameControls(app);
    syncMaskControls(app);
    renderCreatorPreview(app);
  }
  if (target.name === 'backgroundMode') {
    syncBackgroundControls(app);
    await updateAllCutouts(app);
  }
  if (target.name === 'portraitImage') return;
}

async function handleCreatorClick(app, event) {
  const button = event.target?.closest?.('[data-creator-action]');
  if (!button) return;
  event.preventDefault();
  if (app.busy) return;

  switch (button.dataset.creatorAction) {
    case 'browse':
      openCreatorFilePicker(app);
      return;
    case 'open-project':
      openProjectFilePicker(app);
      return;
    case 'upload':
      getCreatorRoot(app)?.querySelector('input[name="upload"]')?.click();
      return;
    case 'flip-x':
    case 'flip-y':
      if (canFlip(app)) flipWorkspace(app, button.dataset.creatorAction === 'flip-x' ? 'x' : 'y');
      return;
    case 'portrait': {
      const portrait = getDocumentActor(app.tokenDocument)?.img;
      if (portrait) await loadCreatorSource(app, { path: portrait });
      return;
    }
    case 'mask-move':
      setMaskTool(app, null);
      return;
    case 'mask-pin':
      selectPinTool(app);
      return;
    case 'mask-region':
      selectRegionTool(app);
      return;
    case 'effect-add':
      addCreatorEffect(app);
      return;
    case 'effect-select':
      selectCreatorEffect(app, button.dataset.effectId);
      return;
    case 'effect-remove':
      removeCreatorEffect(app, button.dataset.effectId);
      return;
    case 'animation-play':
      if (app.animationPlaying) stopAnimationPlayback(app);
      else startAnimationPlayback(app);
      return;
    case 'keyframe-add':
      addKeyframeAtTime(app);
      return;
    case 'keyframe-remove':
      removeKeyframeAtTime(app);
      return;
    case 'keyframe-seek':
      stopAnimationPlayback(app);
      setAnimationTime(app, Number(button.dataset.time));
      return;
    case 'animation-preset':
      applyAnimationPreset(app, button.dataset.preset);
      return;
    case 'animation-auto':
      await runAutoAnimate(app);
      return;
    case 'mask-paint':
    case 'mask-select':
    case 'mask-cut':
    case 'mask-wand':
      selectMaskTool(app, button.dataset.creatorAction.replace('mask-', ''));
      return;
    case 'mask-undo':
      undoMask(app);
      return;
    case 'mask-redo':
      redoMask(app);
      return;
    case 'auto-compose':
      await runAutoCompose(app);
      return;
    case 'compose-pick':
      await applyComposeCandidate(app, Number(button.dataset.composeIndex));
      return;
    case 'token-from-portrait':
      await useEditedPortraitAsToken(app);
      return;
    case 'cleanup-reset':
      if (!app.cleanup.keep && !app.cleanup.remove) return;
      pushMaskHistory(app, 'cleanup');
      app.cleanup = { keep: null, remove: null };
      refreshCleanCutout(app);
      return;
    case 'mask-auto':
      resetPopOutMask(app);
      return;
    case 'mask-clear':
      if (!app.cutout) return;
      pushMaskHistory(app, 'popout');
      app.popOutMask = createCanvas(app.cutout.width, app.cutout.height);
      app._maskVersion += 1;
      syncMaskControls(app);
      renderCreatorPreview(app);
      return;
    case 'view-in':
    case 'view-out':
      setViewScale(
        app,
        stepViewScale(app.viewport.scale, button.dataset.creatorAction === 'view-in' ? 1 : -1),
      );
      return;
    case 'view-reset':
      resetViewport(app);
      return;
    case 'reset-view':
      if (app.editTarget === 'portrait') app.portraitView = { zoom: 1, offsetX: 0, offsetY: 0 };
      else app.view = { zoom: 1, offsetX: 0, offsetY: 0 };
      syncZoomInput(app);
      renderCreatorPreview(app);
      return;
    case 'save':
      await createToken(app, null);
      return;
    case 'apply':
      await createToken(app, button.dataset.applyAction);
      return;
  }
}

async function handleCreatorPaste(app, event) {
  if (!app.rendered) return;
  const active = globalThis.document?.activeElement;
  const root = getCreatorRoot(app);
  if (active && root && !root.contains(active) && active !== globalThis.document.body) return;
  const file = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.type?.startsWith('image/'))
    ?.getAsFile?.();
  if (!file) return;
  event.preventDefault();
  await loadCreatorSource(app, { file });
}

async function handleCreatorDrop(app, event) {
  event.preventDefault();
  const file = [...(event.dataTransfer?.files ?? [])].find((entry) =>
    entry.type?.startsWith('image/'),
  );
  if (file) {
    await loadCreatorSource(app, { file });
    return;
  }
  const path = readDroppedImagePath(event.dataTransfer);
  if (path) await loadCreatorSource(app, { path });
}

function readDroppedImagePath(dataTransfer) {
  const text = dataTransfer?.getData?.('text/plain');
  if (!text) return '';
  try {
    const data = JSON.parse(text);
    return data?.texture?.src ?? data?.src ?? data?.img ?? '';
  } catch {
    return /\.(avif|webp|png|jpe?g|gif)(\?.*)?$/i.test(text) ? text : '';
  }
}

function openCreatorFilePicker(app) {
  const FilePicker = getFilePickerImplementation();
  if (!FilePicker) return;
  const current = app.source?.path ?? getDocumentActor(app.tokenDocument)?.img ?? '';
  new FilePicker({
    type: 'image',
    current,
    callback: (path) => void loadCreatorSource(app, { path }),
  }).render(true);
}

/** Browses for a `.tokener.json` project (text files) and opens it in the creator. */
function openProjectFilePicker(app) {
  const FilePicker = getFilePickerImplementation();
  if (!FilePicker) return;
  const link = app.tokenDocument?.isTokenerActorProxy
    ? app.tokenDocument.prototypeToken
    : app.tokenDocument;
  const current =
    link?._source?.flags?.[MODULE_ID]?.project?.path ??
    link?._source?.texture?.src ??
    link?.texture?.src ??
    '';
  new FilePicker({
    type: 'text',
    current,
    callback: (path) => {
      if (!/\.json$/i.test(String(path ?? ''))) {
        setCreatorStatus(
          app,
          localize('Creator.ProjectNotJson', 'Choose a .tokener.json project file.'),
          true,
        );
        return;
      }
      void loadCreatorProject(app, path);
    },
  }).render(true);
}

async function loadCreatorSource(app, { path, file }) {
  // An image picked while a project is still opening wins over that project.
  app._projectLoadToken = (app._projectLoadToken ?? 0) + 1;
  setCreatorStatus(app, localize('Creator.Loading', 'Loading image...'));
  try {
    const image = await loadImageElement(file ? URL.createObjectURL(file) : path, Boolean(file));
    const canvas = drawToWorkingCanvas(image);
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    app.source = {
      canvas,
      path: file ? null : path,
      file: file ?? null,
      label: deriveSourceLabel(app, path, file),
    };
    app.cleanup = { keep: null, remove: null };
    app._maskHistory = { undo: [], redo: [] };
    app.portraitView = { zoom: 1, offsetX: 0, offsetY: 0 };
    if (app.workspace === app.workspaces.token) {
      app.popOutMask = null;
      app._maskVersion += 1;
      app.view = { zoom: 1, offsetX: 0, offsetY: 0 };
      clearAnimationPins(app);
    }
    syncZoomInput(app);
    await updateCutout(app);
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to load token creator image`, error);
    app.source = null;
    app.cutout = null;
    syncAnimationControls(app);
    renderCreatorPreview(app);
    setCreatorStatus(
      app,
      localize(
        'Creator.LoadFailed',
        'Could not load that image. Images from other sites may block editing.',
      ),
      true,
    );
  }
}

/**
 * Reopens a saved Token Creator project: sources (by path), views, options, the pop-out mask,
 * touch-ups, animation, effects and their regions. Everything is fetched and decoded before
 * the creator is touched, so a failure (missing project or image file, unknown version) leaves
 * the current state as it was (an empty creator stays empty) with `Creator.ProjectLoadFailed`.
 * A background removal that fails while reopening keeps its error on the status line (the
 * project is still open). `fetchJson` / `loadImage` / `updateCutouts` are injectable for tests.
 * Resolves true when the project loaded.
 */
export async function loadCreatorProject(
  app,
  path,
  {
    fetchJson = fetchProjectJson,
    loadImage = loadProjectImage,
    updateCutouts = updateAllCutouts,
  } = {},
) {
  const token = (app._projectLoadToken = (app._projectLoadToken ?? 0) + 1);
  setCreatorStatus(app, localize('Creator.ProjectLoading', 'Opening the saved project...'));
  let restored;
  try {
    const project = parseProject(await fetchJson(path));
    if (!project) throw new Error(`Not a Token Creator project: ${path}`);
    restored = await decodeProject(project, loadImage);
  } catch (error) {
    if (token !== app._projectLoadToken) return false;
    console.error(`${MODULE_ID} | Failed to open token creator project ${path}`, error);
    setCreatorStatus(
      app,
      localize(
        'Creator.ProjectLoadFailed',
        'Could not open the saved project. Its files may have been moved or deleted.',
      ),
      true,
    );
    return false;
  }
  if (token !== app._projectLoadToken) return false;
  applyLoadedProject(app, restored);
  // Re-run the background removal with the saved options so autoCutout is rebuilt; the saved
  // touch-ups (already on each workspace) are composed over it by updateCutout.
  const errors = ((await updateCutouts(app)) ?? []).filter(Boolean);
  if (token !== app._projectLoadToken) return false;
  if (app.rendered && typeof app.render === 'function') await app.render({ parts: ['main'] });
  // A failed background removal keeps its error on the status line (the render above cleared it).
  if (errors.length)
    setCreatorStatus(
      app,
      `${errors[0]} ${localize('Creator.ProjectLoadedWithError', 'The saved project is still open for editing.')}`,
      true,
    );
  else setCreatorStatus(app, localize('Creator.ProjectLoaded', 'Editing the saved project.'));
  return true;
}

async function fetchProjectJson(path) {
  const url = globalThis.foundry?.utils?.getRoute?.(path) ?? path;
  const fetchJsonWithTimeout = globalThis.foundry?.utils?.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout === 'function') return fetchJsonWithTimeout(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function loadProjectImage(src) {
  const url = src.startsWith('data:') ? src : (globalThis.foundry?.utils?.getRoute?.(src) ?? src);
  return loadImageElement(url, false);
}

/** Loads every image a parsed project refers to into canvases, without touching the app. */
async function decodeProject(project, loadImage) {
  // The source file is unflipped; the saved flip is applied to it here. Masks and regions are
  // saved already flipped, so they are restored as they are.
  const loadSource = async (path, flip) => {
    const canvas = drawToWorkingCanvas(await loadImage(path));
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return applyFlip(canvas, flip, createCanvas);
  };
  // Masks and regions are stored at source resolution; drawing them at the source size keeps
  // them aligned even if a mask was saved at a slightly different working size.
  const loadMask = async (dataUrl, size) => {
    if (!dataUrl) return null;
    const image = await loadImage(dataUrl);
    const canvas = createCanvas(size.width, size.height);
    canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
    return canvas;
  };
  const loadWorkspace = async (workspace, shared) => {
    const flip = normalizeFlip(workspace.flip);
    const canvas =
      shared &&
      workspace.sourcePath === shared.path &&
      flip.x === shared.flip.x &&
      flip.y === shared.flip.y
        ? shared.canvas
        : await loadSource(workspace.sourcePath, flip);
    return {
      path: workspace.sourcePath,
      flip,
      canvas,
      popOutMask: await loadMask(workspace.popOutMask, canvas),
      keep: await loadMask(workspace.cleanup.keep, canvas),
      remove: await loadMask(workspace.cleanup.remove, canvas),
    };
  };
  const token = await loadWorkspace(project.token);
  const portrait = project.portrait ? await loadWorkspace(project.portrait, token) : null;
  // Region keys come from the file: no prototype, and only keys parseProject would accept.
  const regions = Object.create(null);
  for (const [key, dataUrl] of Object.entries(project.animation.regions ?? {}))
    if (isSafeEffectKey(key)) regions[key] = await loadMask(dataUrl, token.canvas);
  return { project, token, portrait, regions };
}

/** Swaps the decoded project into the creator; selections, history and caches start fresh. */
function applyLoadedProject(app, { project, token, portrait, regions }) {
  stopAnimationPlayback(app);
  let options = normalizeTokenCreatorOptions(project.options);
  if (AI_BACKGROUND_MODES.includes(options.backgroundMode) && !areAiToolsEnabled())
    options = { ...options, backgroundMode: 'auto' };
  app.creatorOptions = options;
  const label = project.label || deriveSourceLabel(app, token.path, null);
  const workspace = (loaded, sharedSource) => ({
    ...createWorkspace(),
    source: sharedSource ?? {
      canvas: loaded.canvas,
      path: loaded.path,
      file: null,
      label,
      flip: loaded.flip,
    },
    cleanup: { keep: loaded.keep, remove: loaded.remove },
  });
  const tokenWorkspace = workspace(token);
  app.workspaces = {
    token: tokenWorkspace,
    portrait: portrait
      ? workspace(portrait, portrait.canvas === token.canvas ? tokenWorkspace.source : null)
      : null,
  };
  app.editTarget = 'token';
  app.view = { ...project.token.view };
  // The top-level portraitView is the single source of truth for portrait framing.
  app.portraitView = { ...project.portraitView };
  app.viewport = { scale: 1, panX: 0, panY: 0 };
  app.popOutMask = token.popOutMask;
  app._maskVersion += 1;
  app._maskHistory = { undo: [], redo: [] };
  app.maskTool = null;
  app._compose = null;
  const animation = { ...project.animation };
  delete animation.regions;
  app.animation = animation;
  app.animationTime = 0;
  app.selectedPinIds = [];
  app.effectRegions = regions;
  app.selectedEffectId = null;
  app._regionVersion += 1;
  clearEffectCaches();
  app._previewBend = null;
  syncZoomInput(app);
}

function loadImageElement(src, revoke) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (revoke) URL.revokeObjectURL(src);
      resolve(image);
    };
    image.onerror = () => {
      if (revoke) URL.revokeObjectURL(src);
      reject(new Error(`Failed to load ${src}`));
    };
    image.src = src;
  });
}

function drawToWorkingCanvas(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const ratio = Math.min(1, WORKING_MAX_SIZE / Math.max(width, height));
  const canvas = createCanvas(
    Math.max(1, Math.round(width * ratio)),
    Math.max(1, Math.round(height * ratio)),
  );
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function scheduleCutout(app) {
  clearTimeout(app._cutoutTimer);
  app._cutoutTimer = setTimeout(() => void updateAllCutouts(app), 150);
}

/**
 * Rebuilds a workspace's cut-out with the current background options. Resolves the status
 * message of a failed background removal (the original image is used instead), or null.
 */
async function updateCutout(app, workspace = app.workspace) {
  if (!workspace.source) {
    renderCreatorPreview(app);
    return null;
  }
  const token = ++workspace.cutoutToken;
  const { backgroundMode, tolerance, feather } = app.creatorOptions;
  const source = workspace.source.canvas;
  const cutout = createCanvas(source.width, source.height);
  const context = cutout.getContext('2d');
  let failure = null;

  // Removal always runs on the image as it was given (un-flipped) and the result is mirrored
  // back, so a live flip, a recompute and a reopened project all give the same cut-out.
  const flip = workspace.source.flip;
  try {
    if (backgroundMode === 'auto') {
      setCreatorStatus(app, localize('Creator.Removing', 'Removing background...'));
      const original = applyFlip(source, flip, createCanvas);
      const imageData = original
        .getContext('2d')
        .getImageData(0, 0, original.width, original.height);
      removeImageBackground(imageData, { tolerance, feather });
      const removed = createCanvas(original.width, original.height);
      removed.getContext('2d').putImageData(imageData, 0, 0);
      context.drawImage(applyFlip(removed, flip, createCanvas), 0, 0);
    } else if (backgroundMode === 'ai') {
      setCreatorStatus(app, localize('Creator.AiRunning', 'Running AI background removal...'));
      // Cached in the original orientation, so flipping never runs the model again.
      workspace.source.aiCutout ??= await removeBackgroundWithModel(
        applyFlip(source, flip, createCanvas),
      );
      context.drawImage(
        applyFlip(workspace.source.aiCutout, flip, createCanvas),
        0,
        0,
        source.width,
        source.height,
      );
    } else {
      context.drawImage(source, 0, 0);
    }
    if (token !== workspace.cutoutToken) return null;
    // A flip during the removal replaced the source: start over on the mirrored image.
    if (workspace.source?.canvas !== source) return updateCutout(app, workspace);
    workspace.autoCutout = cutout;
    workspace.cutout = composeCleanCutout(workspace);
    setCreatorStatus(app, '');
  } catch (error) {
    if (token !== workspace.cutoutToken) return null;
    if (workspace.source?.canvas !== source) return updateCutout(app, workspace);
    console.error(`${MODULE_ID} | Background removal failed`, error);
    workspace.autoCutout = source;
    workspace.cutout = composeCleanCutout(workspace);
    failure = `${localize('Creator.RemoveFailed', 'Background removal failed; using the original image.')} (${describeError(error)})`;
    setCreatorStatus(app, failure, true);
  }
  syncAnimationControls(app);
  renderCreatorPreview(app);
  return failure;
}

/** Rebuilds every workspace's cut-out; resolves the failure messages (null where it worked). */
export async function updateAllCutouts(app) {
  const workspaces = [app.workspaces.token, app.workspaces.portrait].filter(
    (workspace) => workspace?.source,
  );
  return Promise.all(workspaces.map((workspace) => updateCutout(app, workspace)));
}

function createWorkspace() {
  return {
    source: null,
    autoCutout: null,
    cutout: null,
    cleanup: { keep: null, remove: null },
    cutoutToken: 0,
  };
}

/** A separate copy so the portrait can diverge; the image itself is shared until replaced. */
function cloneWorkspace(workspace) {
  return {
    source: workspace.source,
    autoCutout: workspace.autoCutout,
    cutout: workspace.cutout,
    cleanup: {
      keep: cloneMask(workspace.cleanup.keep),
      remove: cloneMask(workspace.cleanup.remove),
    },
    cutoutToken: 0,
  };
}

/**
 * Flip horizontal (`axis` 'x') / vertical ('y') for the workspace being edited. Its source is
 * replaced by a mirrored copy (dropping per-image caches such as the click-to-select analysis),
 * and every workspace showing that same source flips with it: its cut-out and touch-ups, and
 * for the token workspace also the pop-out mask, effect regions, pins and token framing. The
 * portrait framing flips when the portrait shows the flipped image. Flipping twice restores
 * everything exactly. Undo steps for the flipped image no longer line up, so they are cleared.
 * Returns false when there is nothing to flip.
 */
export function flipWorkspace(app, axis) {
  if (axis !== 'x' && axis !== 'y') return false;
  const previous = app.workspace?.source;
  if (!previous?.canvas) return false;
  // One mirrored copy per canvas, so canvases the workspaces share stay shared.
  const mirrored = new Map();
  const flip = (canvas) => {
    if (!canvas) return null;
    if (!mirrored.has(canvas)) mirrored.set(canvas, flipCanvas(canvas, axis, createCanvas));
    return mirrored.get(canvas);
  };
  const { width, height } = previous.canvas;
  const source = {
    canvas: flip(previous.canvas),
    path: previous.path ?? null,
    file: previous.file ?? null,
    label: previous.label,
    flip: toggleFlip(previous.flip, axis),
  };
  // The AI cut-out is cached in the original orientation and stays valid.
  if (previous.aiCutout) source.aiCutout = previous.aiCutout;

  const { token, portrait } = app.workspaces;
  const flipped = [token, portrait].filter((workspace) => workspace?.source === previous);
  for (const workspace of flipped) {
    workspace.source = source;
    workspace.autoCutout = flip(workspace.autoCutout);
    workspace.cleanup = {
      keep: flip(workspace.cleanup?.keep),
      remove: flip(workspace.cleanup?.remove),
    };
    workspace.cutout = workspace.autoCutout
      ? composeCleanCutout(workspace)
      : flip(workspace.cutout);
  }
  if (flipped.includes(token)) {
    app.popOutMask = flip(app.popOutMask);
    app._maskVersion += 1;
    // Mirrored in place: the regions object is shared with the preview.
    for (const key of Object.keys(app.effectRegions ?? {}))
      app.effectRegions[key] = flip(app.effectRegions[key]);
    app._regionVersion += 1;
    app.animation = {
      ...app.animation,
      pins: flipPins(app.animation.pins, axis, { width, height }),
    };
    app.view = flipView(app.view, axis);
  }
  if (flipped.includes(portrait ?? token)) app.portraitView = flipView(app.portraitView, axis);

  app._maskHistory = { undo: [], redo: [] };
  app._compose = null;
  app._previewBend = null;
  app._popOutImage = null;
  app._maskHighlight = null;
  app._regionTint = null;
  app._removedGhost = null;
  clearEffectCaches();
  syncMaskControls(app);
  syncAnimationControls(app);
  renderCreatorPreview(app);
  return true;
}

/** Runs `draw` as if `target` were being edited, so saving never mixes token and portrait. */
function withEditTarget(app, target, draw) {
  const previous = app.editTarget;
  app.editTarget = target;
  try {
    return draw();
  } finally {
    app.editTarget = previous;
  }
}

function setPortraitImageMode(app, mode) {
  if (mode === 'separate') app.workspaces.portrait ??= cloneWorkspace(app.workspaces.token);
  else app.workspaces.portrait = null;
  app._maskHistory = { undo: [], redo: [] };
  syncPortraitControls(app);
  syncFlipControls(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
}

/**
 * Turns the finished portrait into the token's image so it can be framed like any other art.
 * The portrait keeps its current image, so the two targets become separate.
 */
export async function useEditedPortraitAsToken(app) {
  const portrait = app.workspaces.portrait ?? app.workspaces.token;
  if (!portrait.cutout) {
    setCreatorStatus(app, localize('Creator.NoImage', 'Choose an image first.'), true);
    return;
  }
  const canvas = withEditTarget(app, 'portrait', () => renderPortraitCanvas(app));
  app.workspaces.portrait ??= cloneWorkspace(app.workspaces.token);

  const token = app.workspaces.token;
  token.source = { canvas, path: null, file: null, label: portrait.source.label };
  token.cleanup = { keep: null, remove: null };
  app.popOutMask = null;
  app._maskVersion += 1;
  app._maskHistory = { undo: [], redo: [] };
  app.view = { zoom: 1, offsetX: 0, offsetY: 0 };
  clearAnimationPins(app);

  const radio = getCreatorRoot(app)?.querySelector('input[name="editTarget"][value="token"]');
  if (radio) radio.checked = true;
  const separate = getCreatorRoot(app)?.querySelector(
    'input[name="portraitImage"][value="separate"]',
  );
  if (separate) separate.checked = true;
  setEditTarget(app, 'token');
  syncPortraitControls(app);
  await updateCutout(app, token);
}

async function removeBackgroundWithModel(sourceCanvas) {
  aiSegmenterPromise ??= loadTransformers()
    .then(({ pipeline }) =>
      pipeline('background-removal', AI_MODEL_ID, {
        progress_callback: createDownloadTracker((percent) => {
          if (activeCreator)
            setCreatorStatus(activeCreator, formatDownloadStatus('AiDownloading', percent));
        }),
      }),
    )
    .catch((error) => {
      aiSegmenterPromise = null;
      throw error;
    });
  const segmenter = await aiSegmenterPromise;
  const blob = await canvasToBlob(sourceCanvas, 'image/png');
  const url = URL.createObjectURL(blob);
  try {
    const output = await segmenter(url);
    const result = Array.isArray(output) ? output[0] : output;
    const rgba = result.channels === 4 ? result : result.rgba();
    const canvas = createCanvas(rgba.width, rgba.height);
    canvas
      .getContext('2d')
      .putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderCreatorPreview(app) {
  const root = getCreatorRoot(app);
  const canvas = root?.querySelector('.pf2e-tokener-creator-preview');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  root.querySelector('.pf2e-tokener-creator-stage')?.classList.toggle('is-empty', !app.cutout);
  if (!app.cutout) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const size = canvas.width;
  const token = (app._previewTokenCanvas ??= createCanvas(size, size));
  const tokenContext = token.getContext('2d');
  const portraitMode = app.editTarget === 'portrait';
  if (portraitMode) drawPortraitPreview(tokenContext, app, size);
  else drawPreviewToken(tokenContext, app, size);
  if (isCleanupTool(app.maskTool)) drawCleanupGhost(tokenContext, app, size);
  if (!portraitMode && shouldShowMaskOverlay(app)) drawMaskOverlay(tokenContext, app, size);
  if (!portraitMode) drawEffectRegionOverlay(tokenContext, app, size);

  const viewport = getViewport(app, size);
  const isFramed = !portraitMode && (viewport.scale !== 1 || viewport.x !== 0 || viewport.y !== 0);
  context.clearRect(0, 0, size, size);
  if (isFramed) drawViewContext(context, app, viewport, size);
  context.drawImage(token, viewport.x, viewport.y, viewport.size, viewport.size);
  if (isFramed) drawTokenBounds(context, viewport);
  drawPins(context, app, viewport, size);
  drawBrushCursor(context, app, viewport);
}

function getActiveView(app) {
  return app.editTarget === 'portrait' ? app.portraitView : app.view;
}

function getPortraitPreviewRect(app, size) {
  return getPortraitRect({
    size,
    aspect: app.creatorOptions.portraitAspect,
    imageWidth: app.source?.canvas.width ?? 1,
    imageHeight: app.source?.canvas.height ?? 1,
  });
}

/** Size of the frame being edited in preview pixels: the token square or the portrait rectangle. */
function getEditFrameSize(app, size) {
  if (app.editTarget !== 'portrait') return { width: size, height: size };
  const rect = getPortraitPreviewRect(app, size);
  return { width: rect.width, height: rect.height };
}

/** Draws the portrait rectangle with the rest of the image dimmed around it. */
function drawPortraitPreview(context, app, size) {
  const options = app.creatorOptions;
  const rect = getPortraitPreviewRect(app, size);
  const view = app.portraitView;
  const image = options.portraitBackground === 'original' ? app.source.canvas : app.cutout;
  const layout = getRectFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    width: rect.width,
    height: rect.height,
    zoom: view.zoom,
    offsetX: view.offsetX * rect.width,
    offsetY: view.offsetY * rect.height,
  });

  context.clearRect(0, 0, size, size);
  context.save();
  context.globalAlpha = VIEW_CONTEXT_ALPHA;
  context.drawImage(image, rect.x + layout.x, rect.y + layout.y, layout.width, layout.height);
  context.restore();

  const portrait = createCanvas(
    Math.max(1, Math.round(rect.width)),
    Math.max(1, Math.round(rect.height)),
  );
  drawPortrait(portrait.getContext('2d'), {
    source: app.source.canvas,
    cutout: app.cutout,
    width: portrait.width,
    height: portrait.height,
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    background: options.portraitBackground,
    color: options.portraitColor,
  });
  context.drawImage(portrait, rect.x, rect.y, rect.width, rect.height);
  drawTokenBounds(context, { x: rect.x, y: rect.y, size: rect.width, height: rect.height });
}

function renderPortraitCanvas(app) {
  const source = app.source.canvas;
  const ratio = getPortraitAspectRatio(
    app.creatorOptions.portraitAspect,
    source.width,
    source.height,
  );
  const longSide = Math.max(source.width, source.height);
  const width = Math.round(ratio >= 1 ? longSide : longSide * ratio);
  const height = Math.round(ratio >= 1 ? longSide / ratio : longSide);
  const canvas = createCanvas(width, height);
  drawPortrait(canvas.getContext('2d'), {
    source,
    cutout: app.cutout,
    width,
    height,
    zoom: app.portraitView.zoom,
    offsetX: app.portraitView.offsetX,
    offsetY: app.portraitView.offsetY,
    background: app.creatorOptions.portraitBackground,
    color: app.creatorOptions.portraitColor,
  });
  return canvas;
}

/** Flip needs an image in the workspace being edited and an idle creator (click-to-select too). */
export function canFlip(app) {
  return Boolean(app.workspace?.source?.canvas) && !app.busy && !app._samBusy;
}

function syncFlipControls(app) {
  const disabled = !canFlip(app);
  getCreatorRoot(app)
    ?.querySelectorAll?.('[data-creator-action="flip-x"], [data-creator-action="flip-y"]')
    .forEach((button) => (button.disabled = disabled));
}

function setEditTarget(app, target) {
  app.editTarget = target === 'portrait' ? 'portrait' : 'token';
  syncFlipControls(app);
  if (app.editTarget === 'portrait') stopAnimationPlayback(app);
  if (app.editTarget === 'portrait' && !isCleanupTool(app.maskTool)) setMaskTool(app, null);
  getCreatorSection(app)?.setAttribute('data-edit-target', app.editTarget);
  syncZoomInput(app);
  renderCreatorPreview(app);
}

function syncPortraitControls(app) {
  getCreatorSection(app)?.setAttribute(
    'data-portrait-image',
    app.workspaces.portrait ? 'separate' : 'linked',
  );
  getCreatorRoot(app)
    ?.querySelector('.pf2e-tokener-creator-portrait')
    ?.setAttribute('data-background', app.creatorOptions.portraitBackground);
  syncPortraitAnimateControl(app);
}

/**
 * Animate portrait shows only while the token animation can be made and moves; a separate
 * portrait image cannot follow it (its pins and effects belong to the token image).
 */
function syncPortraitAnimateControl(app) {
  const label = getCreatorRoot(app)?.querySelector?.('[data-portrait-animate]');
  if (!label) return;
  label.hidden = !(app.animationSupported && hasActiveMotion(app.animation, app.effectRegions));
  const shared = isPortraitShared(app);
  const input = label.querySelector('input[name="animatePortrait"]');
  if (input) {
    input.disabled = !shared;
    input.checked = Boolean(app.creatorOptions.animatePortrait);
  }
  label.dataset.tooltip = shared
    ? localize(
        'Creator.AnimatePortraitTooltip',
        'Save the portrait as an animated WebP that plays the token animation (15 fps, up to 512 px).',
      )
    : localize(
        'Creator.AnimatePortraitSeparate',
        'Only a portrait that uses the token image can be animated. Switch the portrait image back to the token image to animate it.',
      );
}

function getViewport(app, size = PREVIEW_SIZE) {
  return getPreviewViewport({
    size,
    scale: app.viewport.scale,
    panX: app.viewport.panX,
    panY: app.viewport.panY,
  });
}

/** Shows the art outside the token dimmed, so a zoomed-out view reveals what the frame crops. */
function drawViewContext(context, app, viewport, size) {
  const layout = getPreviewLayout(app, size);
  context.save();
  context.globalAlpha = VIEW_CONTEXT_ALPHA;
  context.drawImage(
    app.cutout,
    viewport.x + layout.x * viewport.scale,
    viewport.y + layout.y * viewport.scale,
    layout.width * viewport.scale,
    layout.height * viewport.scale,
  );
  context.restore();
}

function drawTokenBounds(context, viewport) {
  const height = viewport.height ?? viewport.size;
  context.save();
  context.setLineDash([5, 4]);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(143, 185, 214, 0.75)';
  context.strokeRect(viewport.x + 0.5, viewport.y + 0.5, viewport.size - 1, height - 1);
  context.restore();
}

function setViewScale(app, scale) {
  app.viewport.scale = scale;
  if (scale === 1) {
    app.viewport.panX = 0;
    app.viewport.panY = 0;
  }
  syncViewControls(app);
  renderCreatorPreview(app);
}

function resetViewport(app) {
  app.viewport = { scale: 1, panX: 0, panY: 0 };
  syncViewControls(app);
  renderCreatorPreview(app);
}

function syncViewControls(app) {
  const label = getCreatorRoot(app)?.querySelector('[data-creator-action="view-reset"]');
  if (label) label.textContent = `${Math.round(app.viewport.scale * 100)}%`;
}

function getTokenPoint(app, canvas, event) {
  return viewportPointToToken(getViewport(app, canvas.width), getCanvasPoint(canvas, event));
}

function drawCreatedToken(context, app, size, { preview = false, bent = null } = {}) {
  const options = app.creatorOptions;
  // A bent art canvas is already laid out in token space, so it draws at an identity layout.
  const art = bent ? bent.art : app.cutout;
  const popOutImage = bent ? bent.popOut : getPopOutImage(app);
  const view = bent
    ? { zoom: 1, offsetX: 0, offsetY: 0 }
    : { zoom: app.view.zoom, offsetX: app.view.offsetX * size, offsetY: app.view.offsetY * size };
  const ringScale = getActiveRingScale(app);
  const ratio = (size / BORDER_REFERENCE_SIZE) * ringScale;
  if (options.frameStyle === 'ring') {
    const layers = preview ? getRingPreviewLayers(app, size) : null;
    drawRingSubject(context, art, {
      size,
      zoom: view.zoom,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      clipRadius: getRingClipRadius(app),
      ringScale,
      popOut: isPopOutEnabled(app),
      popOutImage,
      popOutShadow: options.popOutShadow,
      layers: layers ?? [],
      guide:
        preview && !layers
          ? {
              ringColor: options.ringColors ? options.ringColor : '#ffffff',
              backgroundColor: options.ringColors ? options.ringBackgroundColor : '',
            }
          : null,
    });
    return;
  }
  drawTokenFrame(context, art, {
    size,
    zoom: view.zoom,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    borderWidth: options.borderWidth * ratio,
    borderColor: options.borderColor,
    fill: options.fill,
    fillColor: options.fillColor,
    popOut: isPopOutEnabled(app),
    popOutImage,
    popOutShadow: options.popOutShadow,
    ringScale,
  });
}

/** Pointer mode for the brush cursor; the pin tool never paints. */
function getPointerMode(app, event) {
  if (app.maskTool === 'pin') return null;
  if (app.maskTool === 'region' && !canPaintRegion(app)) return null;
  return getStrokeMode({ tool: app.maskTool, shiftKey: event.shiftKey, altKey: event.altKey });
}

/** Pins and playback work on the token art only, and only where the loop can be encoded. */
function canEditPins(app) {
  return Boolean(app.cutout && app.editTarget !== 'portrait' && app.animationSupported);
}

/** Asks the browser once whether it can encode the loop; until it answers, animation is off. */
function startAnimationSupportProbe(app) {
  if (app._animationProbe) return;
  app._animationProbe = probeAnimationSupport().then((supported) => {
    app.animationSupported = supported;
    syncAnimationControls(app);
  });
}

function selectPinTool(app) {
  if (canEditPins(app)) setMaskTool(app, 'pin');
}

/** Whether keyframe time `keyTime` is the keyframe time `keyT` (seam-aware, as setKeyframe merges). */
function isAtTime(keyTime, keyT) {
  return loopDistance(keyTime, keyT) < KEYFRAME_MERGE;
}

function formatLoopPercent(t) {
  return `${Math.round(t * 100)}%`;
}

/** The primary (first) selected pin, which the keyframe controls edit. */
function getSelectedPin(app) {
  const id = app.selectedPinIds[0];
  return app.animation.pins.find((pin) => pin.id === id) ?? null;
}

function setAnimationPins(app, pins) {
  app.animation = { ...app.animation, pins };
  const ids = new Set(pins.map((pin) => pin.id));
  app.selectedPinIds = app.selectedPinIds.filter((id) => ids.has(id));
  if (!pins.length) stopAnimationPlayback(app);
}

function updateAnimationPin(app, id, change) {
  setAnimationPins(
    app,
    app.animation.pins.map((pin) => (pin.id === id ? change(pin) : pin)),
  );
}

/**
 * A new token image starts a fresh animation: pins and effects belong to the image they were
 * made on, so both are dropped with the effects' painted regions, their undo steps and the
 * effect caches (the loop length and playback mode stay).
 */
export function clearAnimationPins(app) {
  stopAnimationPlayback(app);
  app.animation = resetAnimationForNewSource(app.animation);
  app.selectedPinIds = [];
  app.effectRegions = {};
  app.selectedEffectId = null;
  app._regionVersion += 1;
  app._maskHistory.undo = app._maskHistory.undo.filter((entry) => entry.layer !== 'region');
  app._maskHistory.redo = app._maskHistory.redo.filter((entry) => entry.layer !== 'region');
  if (app.maskTool === 'region') {
    app.maskTool = null;
    syncMaskControls(app);
  }
  clearEffectCaches();
  app._previewBend = null;
  syncAnimationControls(app);
}

/** The key of an effect's painted region in `app.effectRegions`, or null for the whole figure. */
export function getEffectRegionKey(effect) {
  const region = effect?.region;
  return typeof region === 'string' && region ? region : null;
}

/** A new animation with `effect` appended (params clamped). The old animation is untouched. */
export function addEffect(animation, effect) {
  return { ...animation, effects: normalizeEffects([...(animation?.effects ?? []), effect]) };
}

/**
 * A new animation with effect `id` changed (params clamped, so wind/wobble strength follows the
 * scale). Choosing another particle kind goes back to that kind's own colour. Returns the same
 * animation when there is no such effect.
 */
export function updateEffect(animation, id, changes) {
  const effects = animation?.effects ?? [];
  const index = effects.findIndex((effect) => effect.id === id);
  if (index < 0) return animation;
  const current = effects[index];
  const next = { ...current, ...changes };
  if (
    current.type === 'particles' &&
    'kind' in changes &&
    changes.kind !== current.kind &&
    !('color' in changes)
  )
    next.color = null;
  const [normalized] = normalizeEffects([next]);
  if (!normalized) return animation;
  const list = effects.slice();
  list[index] = normalized;
  return { ...animation, effects: list };
}

/**
 * Removes effect `id` with the region canvases it owns: the one keyed by its id (kept even while
 * it is switched to the whole figure) and the one its `region` names, unless a remaining effect
 * still paints with that key. `regions` is then a new object; `removedRegions` lists the keys.
 */
export function removeEffect({ animation, regions }, id) {
  const effects = animation?.effects ?? [];
  const effect = effects.find((entry) => entry.id === id);
  if (!effect) return { animation, regions, removedRegions: [] };
  const rest = effects.filter((entry) => entry.id !== id);
  const next = { ...animation, effects: rest };
  const used = new Set(rest.map((entry) => getEffectRegionKey(entry)).filter(Boolean));
  const removed = [...new Set([effect.id, getEffectRegionKey(effect)])].filter(
    (key) => key && regions && Object.hasOwn(regions, key) && !used.has(key),
  );
  if (!removed.length) return { animation: next, regions, removedRegions: [] };
  return {
    animation: next,
    regions: Object.fromEntries(
      Object.entries(regions).filter(([name]) => !removed.includes(name)),
    ),
    removedRegions: removed,
  };
}

function getEffectTypeLabel(type) {
  return localize(`Creator.Animate.Effects.Types.${type}`, EFFECT_TYPE_LABELS[type] ?? type);
}

function getParticleKindLabel(kind) {
  return localize(`Creator.Animate.Effects.Particles.${kind}`, PARTICLE_KIND_LABELS[kind] ?? kind);
}

/** Highest wind/wobble strength the scale allows, rounded down to the slider's 0.1 step. */
function getMaxWarpStrength(scale) {
  return Math.floor(Math.min(MAX_WARP_STRENGTH, scale * WARP_STRENGTH_RATIO) * 10) / 10;
}

/**
 * The parameter controls of an effect, in display order: `{ param, input: 'range' | 'select' |
 * 'color', label, value, min, max, step, unit, options }`.
 */
export function getEffectParamControls(effect) {
  if (!effect) return [];
  const label = (param) =>
    localize(`Creator.Animate.Effects.Params.${param}`, EFFECT_PARAM_LABELS[param] ?? param);
  const range = (param, min, max, step, unit = '') => ({
    param,
    input: 'range',
    label: label(param),
    value: effect[param],
    min,
    max,
    step,
    unit,
  });
  const select = (param, options) => ({
    param,
    input: 'select',
    label: label(param),
    value: effect[param],
    options: options.map((option) => ({ ...option, selected: option.value === effect[param] })),
  });
  const color = (value) => ({ param: 'color', input: 'color', label: label('color'), value });
  switch (effect.type) {
    case 'wind':
    case 'wobble':
      return [
        range('strength', 0, getMaxWarpStrength(effect.scale), 0.1, 'px'),
        range('scale', 16, 200, 1, 'px'),
      ];
    case 'flicker':
      return [
        range('amount', 0, 1, 0.05, '%'),
        select(
          'kind',
          Object.keys(FLICKER_KIND_LABELS).map((value) => ({
            value,
            label: localize(`Creator.Animate.Effects.Flicker.${value}`, FLICKER_KIND_LABELS[value]),
          })),
        ),
        range('speed', 1, 12, 1),
      ];
    case 'glow':
      return [color(effect.color), range('size', 1, 60, 1, 'px'), range('pulse', 0, 1, 0.05, '%')];
    case 'particles':
      return [
        select(
          'kind',
          PARTICLE_KINDS.map((value) => ({ value, label: getParticleKindLabel(value) })),
        ),
        range('count', 1, 200, 1),
        color(effect.color ?? PARTICLE_COLORS[effect.kind] ?? '#ffffff'),
        range('size', 1, 20, 0.5, 'px'),
      ];
    default:
      return [];
  }
}

function formatEffectValue(control, value) {
  const number = Number(value) || 0;
  if (control.unit === '%') return `${Math.round(number * 100)}%`;
  return `${Math.round(number * 10) / 10}${control.unit ?? ''}`;
}

function getSelectedEffect(app) {
  const id = app.selectedEffectId;
  return app.animation.effects.find((effect) => effect.id === id) ?? null;
}

/** Whether `effect` can be limited to a painted region (flicker always covers the whole figure). */
function supportsRegion(effect) {
  return Boolean(effect && EFFECT_SUPPORTS_REGION[effect.type]);
}

/**
 * The region brush works on the token art of the selected effect, where animation is possible,
 * when that effect can use a region.
 */
function canPaintRegion(app) {
  return canEditPins(app) && supportsRegion(getSelectedEffect(app));
}

function selectRegionTool(app) {
  if (canPaintRegion(app)) setMaskTool(app, 'region');
}

/** Replaces the animation after an effect change and keeps the selection and tools valid. */
function setAnimationEffects(app, animation) {
  app.animation = animation;
  if (!getSelectedEffect(app)) app.selectedEffectId = null;
  if (!hasActiveMotion(app.animation, app.effectRegions)) stopAnimationPlayback(app);
  if (app.maskTool === 'region' && !canPaintRegion(app)) setMaskTool(app, null);
}

function addCreatorEffect(app) {
  if (!canEditPins(app)) return;
  const root = getCreatorRoot(app);
  const type = root?.querySelector('select[name="effectType"]')?.value;
  if (!EFFECT_TYPES.includes(type)) return;
  const effect = createEffect(type);
  if (type === 'particles') {
    const kind = root.querySelector('select[name="effectKind"]')?.value;
    if (PARTICLE_KINDS.includes(kind)) effect.kind = kind;
  }
  setAnimationEffects(app, addEffect(app.animation, effect));
  app.selectedEffectId = effect.id;
  syncAnimationControls(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
}

function selectCreatorEffect(app, id) {
  if (!app.animation.effects.some((effect) => effect.id === id)) return;
  app.selectedEffectId = id;
  syncAnimationControls(app);
  // The region brush follows the selection; an effect without regions (flicker) cannot use it.
  if (app.maskTool === 'region' && !canPaintRegion(app)) setMaskTool(app, null);
  else renderCreatorPreview(app);
}

/** Removes an effect with its painted region; the region's undo steps go with it. */
function removeCreatorEffect(app, id) {
  const result = removeEffect({ animation: app.animation, regions: app.effectRegions }, id);
  if (result.animation === app.animation) return;
  if (result.removedRegions.length) {
    app.effectRegions = result.regions;
    const keep = (entry) =>
      entry.layer !== 'region' || !result.removedRegions.includes(entry.regionKey);
    app._maskHistory.undo = app._maskHistory.undo.filter(keep);
    app._maskHistory.redo = app._maskHistory.redo.filter(keep);
    app._regionVersion += 1;
  }
  const ownStep = (entry) => entry.layer !== 'region' || entry.effectId !== id;
  app._maskHistory.undo = app._maskHistory.undo.filter(ownStep);
  app._maskHistory.redo = app._maskHistory.redo.filter(ownStep);
  clearEffectCaches();
  app._previewBend = null;
  setAnimationEffects(app, result.animation);
  syncAnimationControls(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
}

/**
 * Whole figure / painted region for the selected effect. A painted region is keyed by the
 * effect's id; its canvas is kept when switching back to the whole figure so it can return.
 */
function setEffectRegionMode(app, painted) {
  const effect = getSelectedEffect(app);
  if (!effect || (painted && !supportsRegion(effect))) return;
  const region = painted ? (getEffectRegionKey(effect) ?? effect.id) : null;
  if (region !== getEffectRegionKey(effect))
    setAnimationEffects(app, updateEffect(app.animation, effect.id, { region }));
  syncAnimationControls(app);
  if (painted) selectRegionTool(app);
  else if (app.maskTool === 'region') setMaskTool(app, null);
  else renderCreatorPreview(app);
}

/** Applies a parameter control of the selected effect without rebuilding the controls. */
function updateEffectParam(app, input) {
  const effect = getSelectedEffect(app);
  const param = input.dataset.effectParam;
  if (!effect || !param) return;
  const value = input.type === 'range' ? Number(input.value) : input.value;
  app.animation = updateEffect(app.animation, effect.id, { [param]: value });
  const updated = getSelectedEffect(app);
  const panel = input.closest?.('[data-effect-params]');
  if (panel && updated) {
    for (const control of getEffectParamControls(updated)) {
      const field = panel.querySelector(`[data-effect-param="${control.param}"]`);
      if (!field) continue;
      if (control.input === 'range') {
        field.max = String(control.max);
        if (field !== input) field.value = String(control.value);
      } else if (field !== input) field.value = String(control.value);
      const label = panel.querySelector(`[data-effect-value="${control.param}"]`);
      if (label) label.textContent = formatEffectValue(control, control.value);
    }
  }
  const row = getCreatorRoot(app)?.querySelector?.(
    `[data-creator-action="effect-select"][data-effect-id="${escapeSelectorValue(effect.id)}"] span`,
  );
  if (row && updated) row.textContent = describeEffect(updated);
  renderCreatorPreview(app);
}

/**
 * Starts a region stroke on the selected effect: switches it to a painted region if it was the
 * whole figure, records an undo step and returns the region key (null when it cannot paint).
 */
function startRegionStroke(app) {
  if (!canPaintRegion(app)) return null;
  stopAnimationPlayback(app);
  const effect = getSelectedEffect(app);
  const key = getEffectRegionKey(effect) ?? effect.id;
  // Recorded before the switch, so undoing the first stroke also returns to the whole figure.
  pushMaskHistory(app, 'region', { regionKey: key, effectId: effect.id });
  if (!getEffectRegionKey(effect)) {
    app.animation = updateEffect(app.animation, effect.id, { region: key });
    syncAnimationControls(app);
  }
  return key;
}

/** The region canvas for `key`, in source-image px (the cut-out's size), created on demand. */
function ensureEffectRegion(app, key) {
  const current = app.effectRegions[key];
  if (current && current.width === app.cutout.width && current.height === app.cutout.height)
    return current;
  const canvas = createCanvas(app.cutout.width, app.cutout.height);
  app.effectRegions[key] = canvas;
  return canvas;
}

/**
 * Paints (or erases) a region stroke in place. The preview is unbent while the region tool is
 * active, so the bend and effect caches are only reset when the stroke ends.
 */
function paintEffectRegion(app, key, from, to, mode) {
  if (!app.cutout) return;
  const region = ensureEffectRegion(app, key);
  const layout = getPreviewLayout(app);
  const toImage = (point) =>
    previewPointToImage({
      layout,
      imageWidth: app.cutout.width,
      imageHeight: app.cutout.height,
      x: point.x,
      y: point.y,
    });
  const start = toImage(from);
  const end = toImage(to);
  const context = region.getContext('2d');
  context.save();
  context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = app.brushSize * end.scale;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.arc(end.x, end.y, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
  app._regionVersion += 1;
  renderCreatorPreview(app);
}

/** The region canvas changed in place: forget everything cached by its identity. */
function finishRegionStroke(app) {
  clearEffectCaches();
  app._previewBend = null;
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

/** While the region brush is active, the selected effect's region is tinted over the art. */
function drawEffectRegionOverlay(context, app, size) {
  if (app.maskTool !== 'region' || !app.cutout) return;
  const key = getEffectRegionKey(getSelectedEffect(app));
  const region = key ? app.effectRegions[key] : null;
  if (!region) return;
  // One tint canvas is reused (reallocated only for a new size) and redrawn when the region or
  // its paint changes, so strokes do not allocate a full-resolution canvas per move.
  let cached = app._regionTint;
  if (!cached || cached.tint.width !== region.width || cached.tint.height !== region.height) {
    cached = { tint: createCanvas(region.width, region.height), region: null, version: -1 };
    app._regionTint = cached;
  }
  const tint = cached.tint;
  if (cached.region !== region || cached.version !== app._regionVersion) {
    const tintContext = tint.getContext('2d');
    tintContext.save();
    tintContext.clearRect(0, 0, tint.width, tint.height);
    tintContext.drawImage(region, 0, 0);
    tintContext.globalCompositeOperation = 'source-in';
    tintContext.fillStyle = REGION_COLOR;
    tintContext.fillRect(0, 0, tint.width, tint.height);
    tintContext.restore();
    cached.region = region;
    cached.version = app._regionVersion;
  }
  const layout = getPreviewLayout(app, size);
  context.save();
  context.globalAlpha = REGION_OVERLAY_ALPHA;
  context.drawImage(tint, layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

function describeEffect(effect) {
  const type = getEffectTypeLabel(effect.type);
  const name = effect.type === 'particles' ? `${type}: ${getParticleKindLabel(effect.kind)}` : type;
  if (!getEffectRegionKey(effect)) return name;
  return `${name} (${localize('Creator.Animate.Effects.RegionShort', 'region')})`;
}

/**
 * Effects list and the selected effect's controls, built from `app.animation.effects`. They are
 * rebuilt only when the effects or the selection change, so a control being dragged survives
 * unrelated syncs. Built controls carry `data-animation-control` so they share its enabling.
 */
function syncEffectControls(app) {
  const root = getCreatorRoot(app);
  const panel = root?.querySelector?.('[data-effects]');
  const selected = getSelectedEffect(app);
  const regionButton = root?.querySelector?.('[data-creator-action="mask-region"]');
  if (regionButton) regionButton.hidden = !supportsRegion(selected);
  if (!panel) return;
  const type = panel.querySelector('select[name="effectType"]')?.value;
  const kindPicker = panel.querySelector('[data-effect-kind-picker]');
  if (kindPicker) kindPicker.hidden = type !== 'particles';

  const signature = JSON.stringify([
    app.animation.effects,
    app.selectedEffectId,
    Object.keys(app.effectRegions ?? {}),
  ]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  const doc = panel.ownerDocument;
  const make = (tag, props = {}) => Object.assign(doc.createElement(tag), props);

  const empty = panel.querySelector('[data-effects-empty]');
  if (empty) empty.hidden = app.animation.effects.length > 0;
  const list = panel.querySelector('[data-effects-list]');
  if (list) {
    list.replaceChildren();
    for (const effect of app.animation.effects) {
      const item = make('li', { className: 'pf2e-tokener-creator-effect' });
      item.classList.toggle('is-selected', effect.id === app.selectedEffectId);
      const choose = make('button', {
        type: 'button',
        className: 'pf2e-tokener-creator-effect-select',
      });
      choose.dataset.creatorAction = 'effect-select';
      choose.dataset.effectId = effect.id;
      choose.dataset.animationControl = '';
      choose.setAttribute('aria-pressed', effect.id === app.selectedEffectId ? 'true' : 'false');
      choose.append(
        make('i', { className: `fas ${EFFECT_ICONS[effect.type] ?? 'fa-star'}` }),
        make('span', { textContent: describeEffect(effect) }),
      );
      const remove = make('button', {
        type: 'button',
        className: 'pf2e-tokener-creator-icon-button',
      });
      const removeLabel = localize('Creator.Animate.Effects.Remove', 'Remove effect');
      remove.dataset.creatorAction = 'effect-remove';
      remove.dataset.effectId = effect.id;
      remove.dataset.animationControl = '';
      remove.dataset.tooltip = removeLabel;
      remove.setAttribute('aria-label', removeLabel);
      remove.append(make('i', { className: 'fas fa-trash' }));
      item.append(choose, remove);
      list.append(item);
    }
  }

  const params = panel.querySelector('[data-effect-params]');
  if (!params) return;
  params.replaceChildren();
  params.hidden = !selected;
  if (!selected) return;
  const painted = Boolean(getEffectRegionKey(selected));
  const modes = make('div', {
    className: 'pf2e-tokener-creator-segmented pf2e-tokener-creator-effect-region',
  });
  for (const value of ['whole', 'painted']) {
    const option = make('label');
    option.dataset.tooltip =
      value === 'whole'
        ? localize(
            'Creator.Animate.Effects.WholeTooltip',
            'The effect covers the whole figure (particles rise around it)',
          )
        : localize(
            'Creator.Animate.Effects.PaintedTooltip',
            'The effect covers only the area painted with the region brush (F)',
          );
    const radio = make('input', {
      type: 'radio',
      name: 'effectRegion',
      value,
      checked: (value === 'painted') === painted,
    });
    radio.dataset.animationControl = '';
    const text =
      value === 'painted'
        ? localize('Creator.Animate.Effects.Painted', 'Painted region')
        : selected.type === 'particles'
          ? localize('Creator.Animate.Effects.Around', 'Around the figure')
          : localize('Creator.Animate.Effects.Whole', 'Whole figure');
    option.append(radio, make('span', { textContent: text }));
    modes.append(option);
  }
  // Flicker always covers the whole figure, so it gets no Whole / Painted toggle.
  if (supportsRegion(selected)) params.append(modes);

  const grid = make('div', { className: 'pf2e-tokener-creator-effect-controls' });
  for (const control of getEffectParamControls(selected)) {
    const field = make('label', { className: 'pf2e-tokener-creator-slider' });
    field.append(make('span', { textContent: control.label }));
    let input;
    if (control.input === 'range') {
      const value = make('span', {
        className: 'pf2e-tokener-creator-value',
        textContent: formatEffectValue(control, control.value),
      });
      value.dataset.effectValue = control.param;
      field.append(value);
      input = make('input', {
        type: 'range',
        min: String(control.min),
        max: String(control.max),
        step: String(control.step),
      });
      input.value = String(control.value);
    } else if (control.input === 'select') {
      input = make('select');
      for (const option of control.options)
        input.append(
          make('option', {
            value: option.value,
            textContent: option.label,
            selected: option.selected,
          }),
        );
    } else {
      input = make('input', { type: 'color', value: control.value });
    }
    input.name = 'effectParam';
    input.dataset.effectParam = control.param;
    input.dataset.animationControl = '';
    field.append(input);
    grid.append(field);
  }
  params.append(grid);
  if (painted && !hasPaintedRegion(selected, app.effectRegions))
    params.append(
      make('p', {
        className: 'pf2e-tokener-creator-hint',
        textContent: localize(
          'Creator.Animate.Effects.PaintHint',
          'Paint the region with the region brush (F); until then the effect does nothing.',
        ),
      }),
    );
}

function setAnimationTime(app, t) {
  const value = Number(t);
  app.animationTime = Number.isFinite(value) ? Math.min(0.999, Math.max(0, value)) : 0;
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

function previewPointToSource(app, point) {
  return previewPointToImage({
    layout: getPreviewLayout(app),
    imageWidth: app.cutout.width,
    imageHeight: app.cutout.height,
    x: point.x,
    y: point.y,
  });
}

/** The pin dot nearest to a token-space preview point, within the hit radius on screen. */
function findPinAt(app, point) {
  const points = getPinPreviewPoints({
    pins: app.animation.pins,
    layout: getPreviewLayout(app),
    cutoutWidth: app.cutout.width,
    t: app.animationTime,
    mode: app.animation.mode,
  });
  let best = null;
  const canvas = getCreatorRoot(app)?.querySelector?.('.pf2e-tokener-creator-preview');
  let bestDistance = getPinHitRadius({
    radius: PIN_HIT_RADIUS,
    viewportScale: app.viewport.scale,
    canvasWidth: canvas?.width,
    clientWidth: canvas?.clientWidth,
  });
  for (const candidate of points) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Pin tool press: right-click removes the pin under the pointer; a left press selects that pin
 * (Shift toggles it in the selection instead, without dragging) or adds one, and returns the drag
 * that follows. Dragging places the pin (new pins, or while the animation has no keyframes yet) or
 * keyframes its offset at the current time; only the dragged pin moves.
 */
function startPinDrag(app, point, button, additive = false) {
  const hit = findPinAt(app, point);
  if (button === 2) {
    if (hit) {
      setAnimationPins(
        app,
        app.animation.pins.filter((pin) => pin.id !== hit.id),
      );
      syncAnimationControls(app);
      renderCreatorPreview(app);
    }
    return null;
  }
  if (button !== 0) return null;
  stopAnimationPlayback(app);
  const source = previewPointToSource(app, point);
  let pin = hit ? app.animation.pins.find((entry) => entry.id === hit.id) : null;
  let narrow = false;
  if (pin && additive) {
    app.selectedPinIds = toggleSelection(app.selectedPinIds, pin.id, true);
    syncAnimationControls(app);
    renderCreatorPreview(app);
    return null;
  }
  if (pin) {
    // Pressing a pin that is already selected keeps the selection while it is dragged alone; a
    // click without moving narrows the selection to it (see endDrag).
    narrow = app.selectedPinIds.includes(pin.id) && app.selectedPinIds.length > 1;
    if (!app.selectedPinIds.includes(pin.id))
      app.selectedPinIds = toggleSelection(app.selectedPinIds, pin.id, false);
  } else {
    const { width, height } = app.cutout;
    if (source.x < 0 || source.y < 0 || source.x >= width || source.y >= height) return null;
    pin = createPin({ x: source.x, y: source.y, arm: getRotationArm(app.cutout) });
    setAnimationPins(app, [...app.animation.pins, pin]);
    app.selectedPinIds = toggleSelection(app.selectedPinIds, pin.id, additive);
  }
  const offset = samplePinOffset(pin, app.animationTime, app.animation.mode);
  syncAnimationControls(app);
  renderCreatorPreview(app);
  return {
    pinId: pin.id,
    narrow,
    moved: false,
    moveRest: getPinDragMode(pin) === 'rest',
    grabX: source.x - (pin.x + offset.dx),
    grabY: source.y - (pin.y + offset.dy),
  };
}

function dragPin(app, drag, point) {
  drag.moved = true;
  const source = previewPointToSource(app, point);
  const x = source.x - drag.grabX;
  const y = source.y - drag.grabY;
  updateAnimationPin(app, drag.pinId, (pin) =>
    drag.moveRest
      ? { ...pin, x, y }
      : updateKeyframeAt(
          pin,
          app.animationTime,
          { dx: x - pin.x, dy: y - pin.y },
          app.animation.mode,
        ),
  );
  renderCreatorPreview(app);
}

function addKeyframeAtTime(app) {
  const pin = getSelectedPin(app);
  if (!pin || !canEditPins(app)) return;
  stopAnimationPlayback(app);
  const t = app.animationTime;
  updateAnimationPin(app, pin.id, (entry) => updateKeyframeAt(entry, t, {}, app.animation.mode));
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

/**
 * Sets the easing and/or rotation of the primary pin's keyframe at the current time, creating the
 * keyframe from the current pose when there is none. Pins made before rotation existed get an arm.
 */
function setPrimaryKeyframe(app, changes) {
  const pin = getSelectedPin(app);
  if (!pin || !canEditPins(app)) return;
  stopAnimationPlayback(app);
  updateAnimationPin(app, pin.id, (entry) => {
    const next = updateKeyframeAt(entry, app.animationTime, changes, app.animation.mode);
    return 'rot' in changes ? ensurePinArm(next, app.cutout) : next;
  });
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

function removeKeyframeAtTime(app) {
  const pin = getSelectedPin(app);
  if (!pin || !canEditPins(app)) return;
  stopAnimationPlayback(app);
  updateAnimationPin(app, pin.id, (entry) =>
    removeKeyframe(entry, getKeyframeTime(app.animationTime, app.animation.mode)),
  );
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

function applyAnimationPreset(app, preset) {
  if (!ANIMATION_PRESETS.includes(preset) || !canEditPins(app)) return;
  if (!isPresetAvailable(app.animation.pins, app.selectedPinIds, preset)) return;
  // Selection order matters: Wave staggers its sway along it.
  const ids = getPresetTargets(app.animation.pins, app.selectedPinIds, preset);
  const amplitude = getPresetAmplitude(preset, app.cutout);
  // Pins made before rotation existed get an arm so Look (and later rotation) visibly turns them.
  const targets = new Set(ids);
  const pins = app.animation.pins.map((pin) =>
    targets.has(pin.id) ? ensurePinArm(pin, app.cutout) : pin,
  );
  setAnimationPins(app, applyPreset(pins, ids, preset, { amplitude, mode: app.animation.mode }));
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

/** Auto animate: pins and an idle loop from the cut-out's silhouette, after a confirm if pins exist. */
async function runAutoAnimate(app) {
  if (!canEditPins(app) || app.busy) return;
  const cutout = app.cutout;
  if (app.animation.pins.length) {
    const confirmed = await confirmAutoAnimate();
    if (!confirmed || app.cutout !== cutout) return;
  }
  const alpha = getAlphaGrid(
    cutout.getContext('2d').getImageData(0, 0, cutout.width, cutout.height),
  );
  const { pins, selectedPinIds } = buildAutoRig({
    alpha,
    cutoutWidth: cutout.width,
    cutoutHeight: cutout.height,
    view: app.view,
    clipRadius: getComposeClipRadius(app),
    gridSize: DEFAULT_COMPOSE_GRID,
    mode: app.animation.mode,
  });
  if (!pins.length) {
    setCreatorStatus(app, localize('Creator.Animate.AutoEmpty', 'Nothing to animate yet.'), true);
    return;
  }
  stopAnimationPlayback(app);
  app.animation = { ...app.animation, pins };
  app.selectedPinIds = selectedPinIds;
  app._previewBend = null;
  syncAnimationControls(app);
  renderCreatorPreview(app);
}

async function confirmAutoAnimate() {
  const title = localize('Creator.Animate.AutoAnimate', 'Auto animate');
  const message = localize(
    'Creator.Animate.AutoConfirm',
    'Replace the existing pins with automatic ones?',
  );
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (dialog?.confirm) {
    return Boolean(
      await dialog.confirm({ window: { title }, content: `<p>${message}</p>`, rejectClose: false }),
    );
  }
  return typeof globalThis.confirm === 'function'
    ? globalThis.confirm(`${title}: ${message}`)
    : true;
}

function startAnimationPlayback(app) {
  const requestFrame = globalThis.requestAnimationFrame;
  if (app.animationPlaying || !canEditPins(app) || typeof requestFrame !== 'function') return;
  if (!hasActiveMotion(app.animation, app.effectRegions)) return;
  // Mask and touch-up tools edit the still art, so playing switches back to Move first.
  if (!canPlayWithTool(app.maskTool)) setMaskTool(app, null);
  app.animationPlaying = true;
  let last = null;
  const step = (now) => {
    app._animationFrame = null;
    if (!app.animationPlaying) return;
    if (!app.rendered || !canEditPins(app) || !canPlayWithTool(app.maskTool)) {
      stopAnimationPlayback(app);
      return;
    }
    if (last !== null) {
      const t = app.animationTime + (now - last) / 1000 / app.animation.duration;
      app.animationTime = t - Math.floor(t);
    }
    last = now;
    renderCreatorPreview(app);
    syncAnimationTime(app);
    app._animationFrame = requestFrame(step);
  };
  app._animationFrame = requestFrame(step);
  syncAnimationControls(app);
}

function stopAnimationPlayback(app) {
  const wasPlaying = app.animationPlaying;
  app.animationPlaying = false;
  if (app._animationFrame !== null && app._animationFrame !== undefined)
    globalThis.cancelAnimationFrame?.(app._animationFrame);
  app._animationFrame = null;
  if (wasPlaying) syncAnimationControls(app);
}

/**
 * Whether the preview animates the token: not in the portrait, with no motion, while a mask or
 * touch-up tool edits the unbent art, or while a modifier stroke would paint the pop-out mask
 * under Move.
 */
function shouldAnimatePreview(app) {
  if (app.editTarget === 'portrait' || !app.cutout || !hasMotion(app.animation)) return false;
  return shouldBendPreview({ maskTool: app.maskTool, pointerMode: app._pointer?.mode });
}

/**
 * Draws the preview token: still, or the animation frame at the current loop time (bent art,
 * effects, glow and particles). The bend is cached per pose, so redraws for other reasons (pins,
 * options) reuse it.
 */
function drawPreviewToken(context, app, size) {
  if (!shouldAnimatePreview(app)) {
    drawCreatedToken(context, app, size, { preview: true });
    return;
  }
  const popOutImage = isPopOutEnabled(app) ? getPopOutImage(app) : null;
  const regions = app.effectRegions ?? EMPTY_REGIONS;
  const key = {
    animation: app.animation,
    t: app.animationTime,
    zoom: app.view.zoom,
    offsetX: app.view.offsetX,
    offsetY: app.view.offsetY,
    cutout: app.cutout,
    popOutImage,
    regions,
    size,
  };
  const cached = app._previewBend;
  const reuse =
    cached && Object.keys(key).every((name) => cached.key[name] === key[name]) ? cached.bent : null;
  const bent = renderAnimationFrame({
    context,
    size,
    t: app.animationTime,
    art: { cutout: app.cutout, popOutImage, regions },
    view: app.view,
    animation: app.animation,
    createCanvas,
    drawFrame: (frameContext, frameBent) =>
      drawCreatedToken(frameContext, app, size, { preview: true, bent: frameBent }),
    bent: reuse,
  });
  app._previewBend = { key, bent };
}

/**
 * Pin dots while the pin tool is active: selected pins get a gold ring (the primary a wider,
 * thicker one), anchors are hollow.
 */
function drawPins(context, app, viewport, size) {
  if (app.maskTool !== 'pin' || !canEditPins(app) || !app.animation.pins.length) return;
  const points = getPinPreviewPoints({
    pins: app.animation.pins,
    layout: getPreviewLayout(app, size),
    cutoutWidth: app.cutout.width,
    t: app.animationTime,
    mode: app.animation.mode,
    selectedIds: app.selectedPinIds,
  });
  for (const point of points) {
    const x = viewport.x + point.x * viewport.scale;
    const y = viewport.y + point.y * viewport.scale;
    context.save();
    context.beginPath();
    context.arc(x, y, PIN_RADIUS, 0, Math.PI * 2);
    context.lineWidth = 3.5;
    context.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    context.stroke();
    if (!point.anchor) {
      context.fillStyle = PIN_COLOR;
      context.fill();
    }
    context.lineWidth = 1.5;
    context.strokeStyle = PIN_COLOR;
    context.stroke();
    if (point.selected) {
      const ring = PIN_RADIUS + (point.primary ? PIN_PRIMARY_RING : 3.5);
      context.beginPath();
      context.arc(x, y, ring, 0, Math.PI * 2);
      if (point.primary) {
        context.lineWidth = 4.5;
        context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        context.stroke();
      }
      context.lineWidth = point.primary ? 3 : 2;
      context.strokeStyle = PIN_SELECTED_COLOR;
      context.stroke();
    }
    context.restore();
  }
}

function syncAnimationControls(app) {
  const root = getCreatorRoot(app);
  if (!root?.querySelectorAll) return;
  const available = Boolean(app.animationSupported);
  getAnimationSection(app)?.setAttribute('data-available', available ? 'true' : 'false');
  const pin = getSelectedPin(app);
  const atKeyframe = Boolean(pin && getKeyframeAt(pin, app.animationTime, app.animation.mode));
  const moving = hasActiveMotion(app.animation, app.effectRegions);
  const enabled = available && Boolean(app.cutout) && !app.busy;
  syncFlipControls(app);
  syncEffectControls(app);
  syncPortraitAnimateControl(app);
  root.querySelectorAll('[data-animation-control]').forEach((control) => {
    const action = control.dataset.creatorAction;
    let disabled = !enabled;
    if (action === 'keyframe-add') disabled ||= !pin;
    if (action === 'keyframe-remove') disabled ||= !atKeyframe;
    if (action === 'animation-preset')
      disabled ||= !isPresetAvailable(
        app.animation.pins,
        app.selectedPinIds,
        control.dataset.preset,
      );
    if (control.dataset.keyframeControl !== undefined) disabled ||= !pin;
    if (action === 'animation-play') disabled ||= !moving && !app.animationPlaying;
    control.disabled = disabled;
  });

  const play = root.querySelector('[data-creator-action="animation-play"]');
  if (play) {
    const label = app.animationPlaying
      ? localize('Creator.Animate.Pause', 'Pause')
      : localize('Creator.Animate.Play', 'Play');
    play.classList.toggle('is-active', app.animationPlaying);
    play.setAttribute('aria-pressed', app.animationPlaying ? 'true' : 'false');
    play.setAttribute('aria-label', label);
    play.dataset.tooltip = label;
    const icon = play.querySelector('i');
    if (icon) icon.className = `fas fa-${app.animationPlaying ? 'pause' : 'play'}`;
  }
  const duration = root.querySelector('select[name="animationDuration"]');
  if (duration) duration.value = String(app.animation.duration);
  root.querySelectorAll('input[name="animationMode"]').forEach((radio) => {
    radio.checked = radio.value === app.animation.mode;
  });

  const row = root.querySelector('[data-animation-keyframes]');
  if (row) {
    row.querySelectorAll('.pf2e-tokener-creator-keyframe').forEach((marker) => marker.remove());
    for (const key of pin?.keyframes ?? []) {
      // In ping-pong each keyframe is passed twice per loop, so it gets a marker on both legs.
      for (const time of getKeyframeMarkerTimes(key.t, app.animation.mode)) {
        const marker = row.ownerDocument.createElement('button');
        marker.type = 'button';
        marker.className = 'pf2e-tokener-creator-keyframe';
        marker.dataset.creatorAction = 'keyframe-seek';
        marker.dataset.time = String(time);
        marker.dataset.key = String(key.t);
        marker.style.left = `${time * 100}%`;
        marker.setAttribute('aria-label', formatLoopPercent(time));
        marker.disabled = !enabled;
        row.append(marker);
      }
    }
  }
  syncAnimationTime(app);
}

/** Cheap per-frame update of the scrub slider, time label, playhead and current-keyframe marks. */
function syncAnimationTime(app) {
  const root = getCreatorRoot(app);
  if (!root?.querySelector) return;
  const t = app.animationTime;
  const slider = root.querySelector('input[name="animationTime"]');
  if (slider) slider.value = String(Math.round(t * 1000) / 10);
  const label = root.querySelector('[data-animation-time]');
  if (label) label.textContent = formatLoopPercent(t);
  const playhead = root.querySelector('[data-animation-playhead]');
  if (playhead) playhead.style.left = `${t * 100}%`;
  const keyT = getKeyframeTime(t, app.animation.mode);
  root.querySelectorAll('.pf2e-tokener-creator-keyframe').forEach((marker) => {
    marker.classList.toggle('is-current', isAtTime(Number(marker.dataset.key), keyT));
  });
  syncKeyframeControls(app, root);
}

/**
 * Easing and rotation controls show the primary pin's keyframe at the current time, or the
 * sampled rotation and the default easing when there is no keyframe there.
 */
function syncKeyframeControls(app, root) {
  const pin = getSelectedPin(app);
  const key = pin ? getKeyframeAt(pin, app.animationTime, app.animation.mode) : null;
  const rot = key
    ? (key.rot ?? 0)
    : pin
      ? samplePinOffset(pin, app.animationTime, app.animation.mode).rot
      : 0;
  const degrees = Math.round((rot * 180) / Math.PI);
  const ease = root.querySelector('select[name="animationEase"]');
  if (ease) ease.value = key?.ease ?? 'smooth';
  const rotation = root.querySelector('input[name="animationRotation"]');
  if (rotation && root.ownerDocument?.activeElement !== rotation) rotation.value = String(degrees);
  const label = root.querySelector('[data-animation-rotation]');
  if (label) label.textContent = `${degrees}°`;
}

function isPopOutEnabled(app) {
  return app.creatorOptions.popOut && app.creatorOptions.backgroundMode !== 'none';
}

/** The frame shrinks inside the token to leave breakout room only while parts pop out. */
function getActiveRingScale(app) {
  return isPopOutEnabled(app) ? getRingScale(app.creatorOptions.breakoutRoom) : 1;
}

function canMask(app) {
  return Boolean(app.cutout && app.editTarget !== 'portrait' && isPopOutEnabled(app));
}

function shouldShowMaskOverlay(app) {
  if (isCleanupTool(app.maskTool) || app.maskTool === 'pin' || app.maskTool === 'region')
    return false;
  return canMask(app) && Boolean(app.maskTool || app._pointer?.mode);
}

function setMaskTool(app, tool) {
  // The mask overlay and brushes map to the still art, so editing tools pause the preview loop.
  if (!canPlayWithTool(tool)) stopAnimationPlayback(app);
  app.maskTool = tool;
  if (tool && tool !== 'pin' && tool !== 'region' && !isCleanupTool(tool)) ensurePopOutMask(app);
  if (tool === 'select') void prepareSamSelector(app).catch(() => {});
  if (app._pointer) app._pointer.mode = tool === 'pin' ? null : tool === 'region' ? 'paint' : tool;
  syncMaskControls(app);
  syncBrushCursor(app);
  renderCreatorPreview(app);
}

/** Selects a brush, turning on pop-out first so shortcuts work from any state. */
function selectMaskTool(app, tool) {
  if (isCleanupTool(tool)) {
    if (app.cutout) setMaskTool(app, tool);
    return;
  }
  if (!app.cutout || app.creatorOptions.backgroundMode === 'none') return;
  if (app.editTarget === 'portrait') return;
  if (!app.creatorOptions.popOut) {
    app.creatorOptions = normalizeTokenCreatorOptions({ ...app.creatorOptions, popOut: true });
    saveCreatorDefaults(app.creatorOptions);
    const checkbox = getCreatorRoot(app)?.querySelector('input[name="popOut"]');
    if (checkbox) checkbox.checked = true;
    syncFrameControls(app);
  }
  setMaskTool(app, tool);
}

function resetPopOutMask(app) {
  if (!app.cutout) return;
  pushMaskHistory(app);
  app.popOutMask = null;
  app._maskVersion += 1;
  if (app.maskTool) ensurePopOutMask(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
}

function setBrushSize(app, size) {
  app.brushSize = clamp(numberOr(size, DEFAULT_BRUSH_SIZE), 4, 160);
  const input = getCreatorRoot(app)?.querySelector('input[name="brushSize"]');
  if (input) {
    input.value = String(app.brushSize);
    updateValueLabel(input);
  }
  renderCreatorPreview(app);
}

/** `target` names the region step's canvas key and effect: `{ regionKey, effectId }`. */
function pushMaskHistory(app, layer = 'popout', target = null) {
  const history = app._maskHistory;
  const entry = {
    layer,
    regionKey: target?.regionKey ?? null,
    effectId: target?.effectId ?? null,
    workspace: app.workspace,
  };
  entry.snapshot = snapshotLayer(app, layer, app.workspace, entry);
  history.undo.push(entry);
  if (history.undo.length > MASK_HISTORY_LIMIT) history.undo.shift();
  history.redo = [];
  syncMaskControls(app);
}

/** A region step keeps the canvas and the effect's region mode (whole figure or painted). */
function snapshotLayer(app, layer, workspace = app.workspace, entry = null) {
  if (layer === 'region') {
    const effect = app.animation.effects.find((item) => item.id === entry?.effectId);
    return {
      canvas: cloneMask(app.effectRegions[entry?.regionKey]),
      effectRegion: effect ? getEffectRegionKey(effect) : null,
    };
  }
  if (layer === 'cleanup')
    return {
      keep: cloneMask(workspace.cleanup.keep),
      remove: cloneMask(workspace.cleanup.remove),
    };
  return cloneMask(app.popOutMask);
}

function undoMask(app) {
  const history = app._maskHistory;
  const entry = history.undo.pop();
  if (!entry) return;
  history.redo.push({
    ...entry,
    snapshot: snapshotLayer(app, entry.layer, entry.workspace, entry),
  });
  restoreLayer(app, entry);
}

function redoMask(app) {
  const history = app._maskHistory;
  const entry = history.redo.pop();
  if (!entry) return;
  history.undo.push({
    ...entry,
    snapshot: snapshotLayer(app, entry.layer, entry.workspace, entry),
  });
  restoreLayer(app, entry);
}

function restoreLayer(app, { layer, snapshot, regionKey, effectId, workspace = app.workspace }) {
  if (layer === 'region') {
    // A restored region is a new canvas, but the regions object keeps its identity, so the
    // preview bend and the effect caches are reset by hand.
    if (snapshot.canvas) app.effectRegions[regionKey] = snapshot.canvas;
    else delete app.effectRegions[regionKey];
    const effect = app.animation.effects.find((item) => item.id === effectId);
    if (effect && getEffectRegionKey(effect) !== snapshot.effectRegion)
      app.animation = updateEffect(app.animation, effectId, { region: snapshot.effectRegion });
    app._regionVersion += 1;
    clearEffectCaches();
    app._previewBend = null;
    syncMaskControls(app);
    syncAnimationControls(app);
    renderCreatorPreview(app);
    return;
  }
  if (layer === 'cleanup') {
    workspace.cleanup = { keep: snapshot.keep, remove: snapshot.remove };
    workspace.cutout = composeCleanCutout(workspace);
    syncMaskControls(app);
    renderCreatorPreview(app);
    return;
  }
  app.popOutMask = snapshot;
  app._maskVersion += 1;
  if (app.maskTool && !isCleanupTool(app.maskTool)) ensurePopOutMask(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
}

function composeCleanCutout(workspace) {
  return applyCutoutTouchUps({
    base: workspace.autoCutout,
    source: workspace.source?.canvas,
    keep: workspace.cleanup.keep,
    remove: workspace.cleanup.remove,
    createCanvas,
  });
}

function refreshCleanCutout(app) {
  app.cutout = composeCleanCutout(app.workspace);
  renderCreatorPreview(app);
}

function getCleanupLayers(app) {
  const { width, height } = app.source.canvas;
  app.cleanup.keep ??= createCanvas(width, height);
  app.cleanup.remove ??= createCanvas(width, height);
  return app.cleanup;
}

/** Maps a preview point to source-image pixels for whichever frame is being edited. */
function getEditImagePoint(app, point) {
  const size = PREVIEW_SIZE;
  const image = app.source.canvas;
  if (app.editTarget !== 'portrait') {
    return previewPointToImage({
      layout: getPreviewLayout(app, size),
      imageWidth: image.width,
      imageHeight: image.height,
      x: point.x,
      y: point.y,
    });
  }
  return previewPointToImage({
    layout: getPortraitImageLayout(app, size),
    imageWidth: image.width,
    imageHeight: image.height,
    x: point.x,
    y: point.y,
  });
}

function getPortraitImageLayout(app, size) {
  const rect = getPortraitPreviewRect(app, size);
  const image = app.source.canvas;
  const layout = getRectFrameLayout({
    imageWidth: image.width,
    imageHeight: image.height,
    width: rect.width,
    height: rect.height,
    zoom: app.portraitView.zoom,
    offsetX: app.portraitView.offsetX * rect.width,
    offsetY: app.portraitView.offsetY * rect.height,
  });
  return { ...layout, x: layout.x + rect.x, y: layout.y + rect.y };
}

function paintCleanup(app, from, to, mode) {
  const { keep, remove } = getCleanupLayers(app);
  const start = getEditImagePoint(app, from);
  const end = getEditImagePoint(app, to);
  const width = app.brushSize * end.scale;
  const stroke = (canvas, operation) => {
    const context = canvas.getContext('2d');
    context.save();
    context.globalCompositeOperation = operation;
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.arc(end.x, end.y, width / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };
  stroke(mode === 'cut' ? remove : keep, 'source-over');
  stroke(mode === 'cut' ? keep : remove, 'destination-out');
  refreshCleanCutout(app);
}

function fillCleanup(app, point, mode) {
  const source = app.source;
  const imagePoint = getEditImagePoint(app, point);
  source.imageData ??= source.canvas
    .getContext('2d')
    .getImageData(0, 0, source.canvas.width, source.canvas.height);
  const region = getFillRegion(source.imageData, imagePoint.x, imagePoint.y, {
    tolerance: app.creatorOptions.tolerance,
  });
  const { width, height } = source.canvas;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let count = 0;
  for (let index = 0; index < region.length; index += 1) {
    if (!region[index]) continue;
    pixels.fill(255, index * 4, index * 4 + 4);
    count += 1;
  }
  if (!count) return;
  const regionCanvas = createCanvas(width, height);
  regionCanvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);

  pushMaskHistory(app, 'cleanup');
  const { keep, remove } = getCleanupLayers(app);
  const apply = (canvas, operation) => {
    const context = canvas.getContext('2d');
    context.save();
    context.globalCompositeOperation = operation;
    context.drawImage(regionCanvas, 0, 0);
    context.restore();
  };
  apply(mode === 'cut' ? remove : keep, 'source-over');
  apply(mode === 'cut' ? keep : remove, 'destination-out');
  refreshCleanCutout(app);
}

/**
 * While cleaning, the removed parts of the original are drawn faded red on top of the preview,
 * so leftovers and wrongly removed areas are visible even inside an opaque ring background.
 */
function drawCleanupGhost(context, app, size) {
  const removed = getRemovedGhost(app);
  if (!removed) return;
  const layout =
    app.editTarget === 'portrait' ? getPortraitImageLayout(app, size) : getPreviewLayout(app, size);
  context.save();
  context.globalAlpha = CLEANUP_GHOST_ALPHA;
  context.drawImage(removed, layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

function getRemovedGhost(app) {
  const source = app.source;
  if (!source || !app.cutout) return null;
  if (app._removedGhost?.cutout === app.cutout) return app._removedGhost.canvas;
  const canvas = createCanvas(source.canvas.width, source.canvas.height);
  const context = canvas.getContext('2d');
  context.drawImage(source.canvas, 0, 0);
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = CLEANUP_GHOST_TINT;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(app.cutout, 0, 0, canvas.width, canvas.height);
  app._removedGhost = { cutout: app.cutout, canvas };
  return canvas;
}

function cloneMask(mask) {
  if (!mask) return null;
  const copy = createCanvas(mask.width, mask.height);
  copy.getContext('2d').drawImage(mask, 0, 0);
  return copy;
}

function syncMaskControls(app) {
  const root = getCreatorRoot(app);
  if (!root) return;
  const tool = getToolButton(app.maskTool);
  const tools = ['move', 'paint', 'select', 'cut', 'wand', 'pin', 'region'];
  root.querySelectorAll('[data-creator-action^="mask-"]').forEach((button) => {
    const action = button.dataset.creatorAction;
    if (tools.includes(action.replace('mask-', ''))) {
      const active = action === `mask-${tool}`;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
    }
    if (action === 'mask-undo') button.disabled = !app._maskHistory.undo.length;
    if (action === 'mask-redo') button.disabled = !app._maskHistory.redo.length;
  });
}

function syncBrushCursor(app) {
  const stage = getCreatorRoot(app)?.querySelector('.pf2e-tokener-creator-stage');
  stage?.classList.toggle('is-brushing', Boolean(canShowBrush(app) && app._pointer?.mode));
  stage?.classList.toggle(
    'is-selecting',
    Boolean(app.cutout && (app.maskTool === 'wand' || (canMask(app) && app.maskTool === 'select'))),
  );
  stage?.classList.toggle('is-pinning', app.maskTool === 'pin' && canEditPins(app));
}

/**
 * Segment Anything click-to-select: adds the clicked part of the art to the pop-out mask, or
 * removes it. The image is analysed once per source; later clicks only run the mask decoder.
 */
async function selectPopOutPart(app, tokenPoint, { remove = false } = {}) {
  const source = app.source;
  if (!source || !app.cutout || app._samBusy) return;
  const point = previewPointToImage({
    layout: getPreviewLayout(app),
    imageWidth: app.cutout.width,
    imageHeight: app.cutout.height,
    x: tokenPoint.x,
    y: tokenPoint.y,
  });
  if (point.x < 0 || point.y < 0 || point.x >= app.cutout.width || point.y >= app.cutout.height)
    return;

  app._samBusy = true;
  syncFlipControls(app);
  if (source.samReady) setCreatorStatus(app, localize('Creator.Selecting', 'Selecting...'));
  try {
    const select = await prepareSamSelector(app);
    const selection = await select(point);
    if (app.source !== source) return;

    const selectionCanvas = createCanvas(selection.width, selection.height);
    selectionCanvas.getContext('2d').putImageData(selection, 0, 0);
    pushMaskHistory(app);
    ensurePopOutMask(app);
    const context = app.popOutMask.getContext('2d');
    context.save();
    context.globalCompositeOperation = remove ? 'destination-out' : 'source-over';
    context.drawImage(selectionCanvas, 0, 0, app.popOutMask.width, app.popOutMask.height);
    context.restore();
    app._maskVersion += 1;
    syncMaskControls(app);
    renderCreatorPreview(app);
    setCreatorStatus(app, '');
  } catch (error) {
    console.error(`${MODULE_ID} | Click-to-select failed`, error);
    setCreatorStatus(
      app,
      localize(
        'Creator.SelectFailed',
        'Could not load the selection model. Use the brushes instead.',
      ),
      true,
    );
  } finally {
    app._samBusy = false;
    syncFlipControls(app);
  }
}

/**
 * Loads Segment Anything and analyses the current image once, reporting each phase in the
 * status line. Started as soon as the Select tool is picked so the first click is quick.
 */
function prepareSamSelector(app) {
  const source = app.source;
  if (!source) return Promise.reject(new Error('No image loaded.'));
  if (source.samSelect) return source.samSelect;

  const cacheNote = canCacheModels()
    ? ''
    : ` ${localize(
        'Creator.NoModelCache',
        'This address cannot cache models (it needs https or localhost), so they download every session.',
      )}`;
  const report = (message) => {
    if (app.source === source) setCreatorStatus(app, `${message}${cacheNote}`);
  };
  source.samSelect = createSamSelector(source.canvas, {
    onStatus: ({ phase, percent }) => {
      if (phase === 'download') report(formatDownloadStatus('SelectDownloading', percent));
      else if (phase === 'loading')
        report(localize('Creator.SelectLoadingModel', 'Loading the selection model...'));
      else if (phase === 'analysing')
        report(localize('Creator.SelectAnalysing', 'Analysing the image for click-to-select...'));
    },
  }).then(
    (select) => {
      source.samReady = true;
      if (app.source === source && app.maskTool === 'select' && !app._samBusy)
        setCreatorStatus(
          app,
          localize(
            'Creator.SelectReady',
            'Ready: click a part to pop it out, right-click to remove it.',
          ),
        );
      return select;
    },
    (error) => {
      source.samSelect = null;
      throw error;
    },
  );
  return source.samSelect;
}

function describeError(error) {
  const text = String(error?.message ?? error ?? '').trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text || 'unknown error';
}

function formatDownloadStatus(key, percent) {
  const fallbacks = {
    AiDownloading: 'Downloading the background model... {percent}%',
    SelectDownloading: 'Downloading the selection model... {percent}%',
  };
  const fallback = fallbacks[key] ?? fallbacks.SelectDownloading;
  return localize(`Creator.${key}`, fallback).replace('{percent}', String(percent));
}

function canShowBrush(app) {
  if (app.maskTool === 'region') return canPaintRegion(app);
  return isCleanupTool(app.maskTool) ? Boolean(app.cutout) : canMask(app);
}

function drawBrushCursor(context, app, viewport) {
  const pointer = app._pointer;
  if (!pointer?.mode || !canShowBrush(app)) return;
  const radius = (app.brushSize / 2) * viewport.scale;
  context.save();
  context.beginPath();
  context.arc(
    viewport.x + pointer.x * viewport.scale,
    viewport.y + pointer.y * viewport.scale,
    radius,
    0,
    Math.PI * 2,
  );
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  context.stroke();
  context.lineWidth = 1.5;
  context.strokeStyle =
    app.maskTool === 'region' ? REGION_COLOR : (BRUSH_COLORS[pointer.mode] ?? BRUSH_COLORS.paint);
  if (pointer.mode === 'erase' || pointer.mode === 'cut') context.setLineDash([4, 3]);
  context.stroke();
  context.restore();
}

function getPopOutRadius(app, size) {
  const ringScale = getActiveRingScale(app);
  if (app.creatorOptions.frameStyle === 'ring')
    return (size / 2) * getRingClipRadius(app) * ringScale;
  return Math.max(
    0,
    getRingGeometry({ size, ringScale }).outerRadius -
      app.creatorOptions.borderWidth * (size / BORDER_REFERENCE_SIZE) * ringScale,
  );
}

function getPreviewLayout(app, size = PREVIEW_SIZE) {
  return getTokenFrameLayout({
    imageWidth: app.cutout.width,
    imageHeight: app.cutout.height,
    size,
    zoom: app.view.zoom,
    offsetX: app.view.offsetX * size,
    offsetY: app.view.offsetY * size,
  });
}

/** Starts a painted mask from the automatic pop-out area so painting refines what is shown. */
function ensurePopOutMask(app) {
  if (app.popOutMask || !app.cutout) return;
  const mask = createCanvas(app.cutout.width, app.cutout.height);
  const rect = getAutoPopOutRect({
    layout: getPreviewLayout(app),
    imageWidth: app.cutout.width,
    imageHeight: app.cutout.height,
    size: PREVIEW_SIZE,
    radius: getPopOutRadius(app, PREVIEW_SIZE),
  });
  const context = mask.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  app.popOutMask = mask;
  app._maskVersion += 1;
}

function paintPopOutMask(app, from, to, mode = app.maskTool) {
  ensurePopOutMask(app);
  if (!app.popOutMask) return;
  const layout = getPreviewLayout(app);
  const toImage = (point) =>
    previewPointToImage({
      layout,
      imageWidth: app.cutout.width,
      imageHeight: app.cutout.height,
      x: point.x,
      y: point.y,
    });
  const start = toImage(from);
  const end = toImage(to);
  const context = app.popOutMask.getContext('2d');
  context.save();
  // Popped parts only ever show outside the opening, so strokes can cross the frame edge freely.
  clipOutsideOpening(
    context,
    getOpeningInImage({
      layout,
      imageWidth: app.cutout.width,
      imageHeight: app.cutout.height,
      size: PREVIEW_SIZE,
      radius: getPopOutRadius(app, PREVIEW_SIZE),
    }),
    app.popOutMask.width,
    app.popOutMask.height,
  );
  context.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = app.brushSize * end.scale;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.arc(end.x, end.y, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
  app._maskVersion += 1;
  renderCreatorPreview(app);
}

function getPopOutImage(app) {
  if (!app.popOutMask || !app.cutout) return null;
  const cached = app._popOutImage;
  if (cached?.version === app._maskVersion && cached.cutout === app.cutout) return cached.canvas;
  const canvas = createCanvas(app.cutout.width, app.cutout.height);
  const context = canvas.getContext('2d');
  context.drawImage(app.cutout, 0, 0);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(app.popOutMask, 0, 0);
  app._popOutImage = { version: app._maskVersion, cutout: app.cutout, canvas };
  return canvas;
}

/**
 * Mask editing view: the whole cut-out is ghosted behind the frame so every part that could pop
 * out is visible, and the parts that do pop out get a light tint and a bright outline.
 */
function drawMaskOverlay(context, app, size) {
  if (!app.popOutMask) return;
  const layout = getPreviewLayout(app, size);
  context.save();
  context.globalCompositeOperation = 'destination-over';
  context.globalAlpha = MASK_GHOST_ALPHA;
  context.drawImage(app.cutout, layout.x, layout.y, layout.width, layout.height);
  context.restore();

  const imagePixelsPerPreviewPixel = app.cutout.width / Math.max(1, layout.width);
  const layers = getMaskHighlightLayers(app, imagePixelsPerPreviewPixel);
  if (!layers) return;
  context.save();
  clipOutsideOpening(
    context,
    { x: size / 2, y: size / 2, radius: getPopOutRadius(app, size) },
    size,
    size,
  );
  context.drawImage(layers.tint, layout.x, layout.y, layout.width, layout.height);
  context.drawImage(layers.outline, layout.x, layout.y, layout.width, layout.height);
  context.restore();
}

function getMaskHighlightLayers(app, imagePixelsPerPreviewPixel) {
  const selected = getPopOutImage(app);
  if (!selected) return null;
  const thickness = Math.max(1, Math.round(MASK_OUTLINE_WIDTH * imagePixelsPerPreviewPixel));
  const cached = app._maskHighlight;
  if (
    cached?.version === app._maskVersion &&
    cached.cutout === app.cutout &&
    cached.thickness === thickness
  )
    return cached.layers;

  const { width, height } = selected;
  const silhouette = (color) => {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(selected, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    return canvas;
  };
  const ring = (shape, radius) => {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    for (let step = 0; step < 16; step += 1) {
      const angle = (step / 16) * Math.PI * 2;
      context.drawImage(shape, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(selected, 0, 0);
    return canvas;
  };

  const tint = createCanvas(width, height);
  const tintContext = tint.getContext('2d');
  tintContext.globalAlpha = MASK_TINT_ALPHA;
  tintContext.drawImage(silhouette(MASK_HIGHLIGHT_COLOR), 0, 0);

  const outline = createCanvas(width, height);
  const outlineContext = outline.getContext('2d');
  outlineContext.drawImage(ring(silhouette(MASK_OUTLINE_SHADOW), thickness * 1.8), 0, 0);
  outlineContext.drawImage(ring(silhouette(MASK_HIGHLIGHT_COLOR), thickness), 0, 0);

  const layers = { tint, outline };
  app._maskHighlight = { version: app._maskVersion, cutout: app.cutout, thickness, layers };
  return layers;
}

function getCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / (rect.width || canvas.width),
    y: ((event.clientY - rect.top) * canvas.height) / (rect.height || canvas.height),
  };
}

function getRingPreviewLayers(app, size) {
  const assets = app.ringAssets;
  if (!assets) {
    if (!app._ringAssetsRequested) {
      app._ringAssetsRequested = true;
      void loadWorldRingAssets().then((loaded) => {
        app.ringAssets = loaded;
        if (loaded) renderCreatorPreview(app);
      });
    }
    return null;
  }

  const options = app.creatorOptions;
  const gridSize = getTokenGridSize(app.tokenDocument);
  const ringColor = options.ringColors ? options.ringColor : null;
  const backgroundColor = options.ringColors ? options.ringBackgroundColor : null;
  const key = [assets.path, size, gridSize, ringColor, backgroundColor].join('|');
  if (app._ringLayers?.key === key) return app._ringLayers.layers;

  const frame = selectRingFrame(assets.sheet, gridSize);
  if (!frame) return null;
  const background = frame.background ? extractFrame(assets.image, frame.background, size) : null;
  const ring = extractFrame(assets.image, frame.ring, size);
  const mask = frame.mask ? extractFrame(assets.image, frame.mask, size) : null;

  if (background) {
    const context = background.getContext('2d');
    const data = context.getImageData(0, 0, size, size);
    colorizeRingBackground(data, resolveRingColor(backgroundColor, frame.defaultBackgroundColor));
    context.putImageData(data, 0, 0);
  }
  const ringContext = ring.getContext('2d');
  const ringData = ringContext.getImageData(0, 0, size, size);
  colorizeRingFrame(ringData, mask?.getContext('2d').getImageData(0, 0, size, size) ?? null, {
    colorBand: frame.colorBand,
    ringColor: resolveRingColor(ringColor, frame.defaultRingColor),
  });
  ringContext.putImageData(ringData, 0, 0);

  const layers = [background, ring].filter(Boolean);
  app._ringLayers = { key, layers };
  return layers;
}

/**
 * Where the subject stops: the measured inner edge of the world's ring art, falling back to the
 * colour band and then a default when the art is not loaded or cannot be measured.
 */
function getRingClipRadius(app) {
  const assets = app.ringAssets;
  const frame = assets ? selectRingFrame(assets.sheet, getTokenGridSize(app.tokenDocument)) : null;
  if (!frame) return DEFAULT_RING_SUBJECT_RADIUS;
  assets.innerEdges ??= new Map();
  if (!assets.innerEdges.has(frame.ringName)) {
    const size = 256;
    const ring = extractFrame(assets.image, frame.ring, size);
    assets.innerEdges.set(
      frame.ringName,
      measureRingInnerEdge(ring.getContext('2d').getImageData(0, 0, size, size)),
    );
  }
  return (
    assets.innerEdges.get(frame.ringName) ??
    (Number(frame.colorBand?.startRadius) || DEFAULT_RING_SUBJECT_RADIUS)
  );
}

function loadWorldRingAssets() {
  const path = globalThis.CONFIG?.Token?.ring?.spritesheet;
  if (!path) return Promise.resolve(null);
  if (worldRingAssets?.path === path) return worldRingAssets.promise;

  const route = (value) => globalThis.foundry?.utils?.getRoute?.(value) ?? value;
  const promise = (async () => {
    const response = await fetch(route(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sheet = await response.json();
    const imagePath = `${path.replace(/[^/]*$/, '')}${sheet?.meta?.image ?? ''}`;
    const image = await loadImageElement(route(imagePath), false);
    return { path, sheet, image };
  })().catch((error) => {
    console.warn(`${MODULE_ID} | Could not load dynamic token ring art for preview`, error);
    worldRingAssets = null;
    return null;
  });
  worldRingAssets = { path, promise };
  return promise;
}

function extractFrame(image, frame, size) {
  const canvas = createCanvas(size, size);
  canvas.getContext('2d').drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, size, size);
  return canvas;
}

function getTokenGridSize(tokenDocument) {
  const width = numberOr(tokenDocument?.width ?? tokenDocument?.prototypeToken?.width, 1);
  const height = numberOr(tokenDocument?.height ?? tokenDocument?.prototypeToken?.height, width);
  return Math.max(width, height);
}

/**
 * Auto compose: analyse the token cut-out, score framings and pop-out choices, apply the best and
 * show the top alternatives as thumbnails. With AI tools, long popped parts are completed with
 * click-to-select so a whole sword pops out rather than just its tip.
 */
async function runAutoCompose(app) {
  if (app.editTarget === 'portrait') setEditTarget(app, 'token');
  const cutout = app.cutout;
  if (!cutout || app.busy) return;
  setCreatorStatus(app, localize('Creator.Composing', 'Composing...'));
  if (app.creatorOptions.frameStyle === 'ring') app.ringAssets ??= await loadWorldRingAssets();

  const alpha = getAlphaGrid(
    cutout.getContext('2d').getImageData(0, 0, cutout.width, cutout.height),
  );
  if (hasBackgroundLeft(alpha)) {
    setCreatorStatus(
      app,
      localize(
        'Creator.ComposeNeedsCutout',
        'Remove the background first (Auto, AI or touch-ups), then use Auto compose.',
      ),
      true,
    );
    return;
  }
  // Layouts are planned with the frame at its smallest, then each gets just the breakout room
  // its popped parts need.
  const ringScale = getRingScale(MAX_BREAKOUT_ROOM);
  const clipRadius = withComposeOptions(app, { breakoutRoom: MAX_BREAKOUT_ROOM }, () =>
    getComposeClipRadius(app),
  );
  let ranked = composeCandidates({
    alpha,
    clipRadius,
    ringScale,
    maxRoom: MAX_BREAKOUT_ROOM,
    gridSize: DEFAULT_COMPOSE_GRID,
    limit: 40,
  });
  if (ranked.length && areAiToolsEnabled()) {
    try {
      const model = await loadComposeRankingModel();
      if (app.cutout !== cutout) return;
      ranked = rerankComposeCandidates(ranked, alpha, clipRadius, model);
    } catch (error) {
      console.warn(`${MODULE_ID} | Optional Auto Compose ranking unavailable`, error);
    }
  }
  const candidates = pickComposeOptions(ranked, COMPOSE_OPTIONS);
  if (!candidates.length) {
    setCreatorStatus(app, localize('Creator.ComposeEmpty', 'Nothing to compose yet.'), true);
    return;
  }
  app._compose = { cutout, candidates, applied: -1 };
  renderComposeOptions(app);
  await applyComposeCandidate(app, 0);
  setCreatorStatus(
    app,
    localize(
      'Creator.ComposeDone',
      'Applied the best of {count} layouts. Pick another below or fine-tune with the tools.',
    ).replace('{count}', String(candidates.length)),
  );
}

function withComposeOptions(app, options, callback) {
  const saved = app.creatorOptions;
  app.creatorOptions = { ...saved, popOut: true, ...options };
  try {
    return callback();
  } finally {
    app.creatorOptions = saved;
  }
}

function getComposeClipRadius(app) {
  if (app.creatorOptions.frameStyle === 'ring')
    return getRingClipRadius(app) * getActiveRingScale(app);
  const size = PREVIEW_SIZE;
  return getPopOutRadius(app, size) / (size / 2);
}

async function applyComposeCandidate(app, index) {
  const compose = app._compose;
  const candidate = compose?.candidates[index];
  if (!candidate || compose.cutout !== app.cutout) return;
  pushMaskHistory(app, 'popout');
  app.view = { ...candidate.fit.view };
  app.popOutMask = buildComposeMask(app, candidate);
  app._maskVersion += 1;
  app.creatorOptions = normalizeTokenCreatorOptions({
    ...app.creatorOptions,
    popOut: true,
    breakoutRoom: candidate.fit.room,
  });
  saveCreatorDefaults(app.creatorOptions);
  const root = getCreatorRoot(app);
  const checkbox = root?.querySelector('input[name="popOut"]');
  if (checkbox) checkbox.checked = true;
  const room = root?.querySelector('input[name="breakoutRoom"]');
  if (room) {
    room.value = String(candidate.fit.room);
    updateValueLabel(room);
  }
  syncFrameControls(app);
  compose.applied = index;
  syncZoomInput(app);
  syncComposeOptions(app);
  syncMaskControls(app);
  renderCreatorPreview(app);
  if (areAiToolsEnabled()) await completeComposeParts(app, candidate);
}

/** Converts a candidate's popped grid cells into a source-image mask for the current cut-out. */
function buildComposeMask(app, candidate) {
  const gridSize = candidate.protrusions.gridSize;
  const cells = expandPopOutMask(candidate.popOutMask, candidate.protrusions.occupied, gridSize);
  const grid = createCanvas(gridSize, gridSize);
  const pixels = new Uint8ClampedArray(gridSize * gridSize * 4);
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) pixels.fill(255, index * 4, index * 4 + 4);
  }
  grid.getContext('2d').putImageData(new ImageData(pixels, gridSize, gridSize), 0, 0);

  const cutout = app.cutout;
  const layout = getTokenFrameLayout({
    imageWidth: cutout.width,
    imageHeight: cutout.height,
    size: gridSize,
    zoom: candidate.view.zoom,
    offsetX: candidate.view.offsetX * gridSize,
    offsetY: candidate.view.offsetY * gridSize,
  });
  const scale = layout.width / cutout.width;
  const mask = createCanvas(cutout.width, cutout.height);
  mask
    .getContext('2d')
    .drawImage(grid, -layout.x / scale, -layout.y / scale, gridSize / scale, gridSize / scale);
  return mask;
}

/** Adds whole parts (found by click-to-select at each long piece's tip) to the pop-out mask. */
async function completeComposeParts(app, candidate) {
  const parts = candidate.pieces
    .map((id) => candidate.protrusions.pieces[id])
    .filter((piece) => piece.elongation >= 2.5);
  if (!parts.length) return;
  const source = app.source;
  try {
    const select = await prepareSamSelector(app);
    if (app.source !== source || app._compose?.candidates[app._compose.applied] !== candidate)
      return;
    setCreatorStatus(app, localize('Creator.ComposeParts', 'Completing popped parts...'));
    const gridSize = candidate.protrusions.gridSize;
    const cutout = app.cutout;
    const layout = getTokenFrameLayout({
      imageWidth: cutout.width,
      imageHeight: cutout.height,
      size: gridSize,
      zoom: candidate.view.zoom,
      offsetX: candidate.view.offsetX * gridSize,
      offsetY: candidate.view.offsetY * gridSize,
    });
    const scale = layout.width / cutout.width;
    const subjectArea = countOpaque(cutout);
    for (const piece of parts) {
      // Step a little back from the very tip so the click lands on the part, not its edge.
      const point = {
        x: (piece.tip.x * 0.8 + piece.centroid.x * 0.2 - layout.x) / scale,
        y: (piece.tip.y * 0.8 + piece.centroid.y * 0.2 - layout.y) / scale,
      };
      const selection = await select(point);
      if (app.source !== source) return;
      if (countOpaque(selection) > subjectArea * COMPOSE_MAX_PART_SHARE) continue;
      const selectionCanvas = createCanvas(selection.width, selection.height);
      selectionCanvas.getContext('2d').putImageData(selection, 0, 0);
      app.popOutMask
        .getContext('2d')
        .drawImage(selectionCanvas, 0, 0, app.popOutMask.width, app.popOutMask.height);
      app._maskVersion += 1;
    }
    renderCreatorPreview(app);
    setCreatorStatus(app, '');
  } catch (error) {
    console.warn(`${MODULE_ID} | Auto compose could not complete parts`, error);
  }
}

function countOpaque(imageOrCanvas) {
  const data =
    imageOrCanvas.data ??
    imageOrCanvas.getContext('2d').getImageData(0, 0, imageOrCanvas.width, imageOrCanvas.height)
      .data;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] >= 128) count += 1;
  return count;
}

function renderComposeOptions(app) {
  const container = getCreatorRoot(app)?.querySelector('.pf2e-tokener-creator-compose-options');
  const compose = app._compose;
  if (!container || !compose) return;
  container.replaceChildren();
  const saved = {
    view: app.view,
    popOutMask: app.popOutMask,
    maskVersion: app._maskVersion,
    options: app.creatorOptions,
  };
  compose.candidates.forEach((candidate, index) => {
    const button = globalThis.document.createElement('button');
    button.type = 'button';
    button.className = 'pf2e-tokener-creator-compose-option';
    button.dataset.creatorAction = 'compose-pick';
    button.dataset.composeIndex = String(index);
    button.dataset.tooltip = describeComposeCandidate(candidate);
    const canvas = createCanvas(COMPOSE_THUMBNAIL_SIZE, COMPOSE_THUMBNAIL_SIZE);
    app.view = { ...candidate.fit.view };
    app.popOutMask = buildComposeMask(app, candidate);
    app._maskVersion += 1;
    app.creatorOptions = {
      ...saved.options,
      popOut: true,
      breakoutRoom: candidate.fit.room,
    };
    drawCreatedToken(canvas.getContext('2d'), app, COMPOSE_THUMBNAIL_SIZE, { preview: true });
    button.append(canvas);
    container.append(button);
  });
  app.view = saved.view;
  app.popOutMask = saved.popOutMask;
  app._maskVersion = saved.maskVersion + 1;
  app.creatorOptions = saved.options;
  container.closest('.pf2e-tokener-creator-compose')?.classList.add('has-options');
}

function describeComposeCandidate(candidate) {
  const framing =
    {
      figure: localize('Creator.ComposeFigure', 'Whole figure'),
      popout: localize('Creator.ComposeBreakOut', 'Breaking out of the frame'),
    }[candidate.framing.kind] ?? localize('Creator.ComposeHead', 'Head focus');
  const popOut = {
    none: localize('Creator.ComposeNoPopOut', 'no pop-out'),
    top: localize('Creator.ComposeTopPopOut', 'head pops out'),
    'top-parts': localize('Creator.ComposePartsPopOut', 'head and parts pop out'),
    breakout: localize('Creator.ComposeAllPopOut', 'everything breaks out'),
  }[candidate.variant];
  return `${framing}, ${popOut}`;
}

function syncComposeOptions(app) {
  const applied = app._compose?.applied ?? -1;
  getCreatorRoot(app)
    ?.querySelectorAll('.pf2e-tokener-creator-compose-option')
    .forEach((button) =>
      button.classList.toggle('is-active', Number(button.dataset.composeIndex) === applied),
    );
}

export async function createToken(app, action) {
  const tokenWorkspace = app.workspaces.token;
  const portraitWorkspace = app.workspaces.portrait ?? tokenWorkspace;
  if (!tokenWorkspace.cutout) {
    setCreatorStatus(app, localize('Creator.NoImage', 'Choose an image first.'), true);
    return;
  }

  // The saved loop is rendered from a snapshot, so the preview must not keep moving the pose.
  stopAnimationPlayback(app);
  // The project is frozen now, with playback stopped, so edits made while files upload never
  // mix into it.
  let projectState = null;
  try {
    projectState = snapshotProjectState(app);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to snapshot the Token Creator project`, error);
  }
  setCreatorBusy(app, true);
  setCreatorStatus(app, localize('Creator.Saving', 'Saving token...'));
  try {
    const folder = getCreatedTokenFolder({
      worldId: globalThis.game?.world?.id,
      configured: readSetting(CREATED_TOKEN_FOLDER_SETTING_KEY),
    });
    await ensureDataFolder(folder);

    if (app.creatorOptions.frameStyle === 'ring') app.ringAssets ??= await loadWorldRingAssets();
    const now = new Date();
    const label = tokenWorkspace.source.label;
    const size = app.creatorOptions.outputSize;
    const animated =
      getAnimatedSavePlan({
        animation: app.animation,
        canEncode: app.animationSupported,
        regions: app.effectRegions,
      }) === 'animated';
    let tokenSrc;
    if (animated) {
      tokenSrc = await uploadBlob(
        await encodeTokenAnimation(app, getAnimatedOutputSize(size)),
        folder,
        buildCreatedTokenFileName(label, { now, extension: 'webm' }),
      );
      setCreatorStatus(app, localize('Creator.Saving', 'Saving token...'));
    } else {
      const tokenCanvas = createCanvas(size, size);
      withEditTarget(app, 'token', () => drawCreatedToken(tokenCanvas.getContext('2d'), app, size));
      tokenSrc = await uploadCanvas(tokenCanvas, folder, buildCreatedTokenFileName(label, { now }));
    }

    const ringMode = app.creatorOptions.frameStyle === 'ring';
    const subjectSrc = ringMode ? tokenSrc : undefined;
    const ringColors =
      ringMode && app.creatorOptions.ringColors
        ? {
            ring: app.creatorOptions.ringColor,
            background: app.creatorOptions.ringBackgroundColor,
          }
        : undefined;

    const portraitPlan = getPortraitSavePlan({
      action,
      edited: !isPortraitUnchanged(app.creatorOptions, app.portraitView),
      sourcePath: portraitWorkspace.source?.path,
      hasFile: Boolean(portraitWorkspace.source?.file),
    });
    let portraitEdited = portraitPlan === 'render';
    let portraitSrc;
    // Animate portrait: the shared image, bent like the token, saved as an animated WebP.
    let portraitNote = '';
    if (action !== 'token' && wantsPortraitAnimation(app)) {
      const blob = (await canEncodeWebp()) ? await encodePortraitAnimation(app) : null;
      if (blob) {
        portraitSrc = await uploadBlob(
          blob,
          folder,
          buildCreatedTokenFileName(label, { now, suffix: 'portrait' }),
        );
        portraitEdited = true;
      } else
        portraitNote = localize(
          'Creator.AnimatePortraitUnsupported',
          'This browser cannot save animated WebP, so the portrait was saved as a still image.',
        );
      setCreatorStatus(app, localize('Creator.Saving', 'Saving token...'));
    }
    if (portraitSrc) {
      // Already saved as an animated portrait.
    } else if (portraitPlan === 'render') {
      portraitSrc = await uploadCanvas(
        withEditTarget(app, 'portrait', () => renderPortraitCanvas(app)),
        folder,
        buildCreatedTokenFileName(label, { now, suffix: 'portrait' }),
      );
    } else if (portraitPlan === 'path') {
      portraitSrc = portraitWorkspace.source.path;
    } else if (portraitPlan === 'upload-source') {
      portraitSrc = await uploadCanvas(
        portraitWorkspace.source.canvas,
        folder,
        buildCreatedTokenFileName(label, { now, suffix: 'portrait' }),
      );
    }

    // A project that fails to save never fails the token: it is applied without the flag.
    let projectSrc;
    let projectNote = '';
    try {
      projectSrc = await saveCreatorProject(projectState, { folder, tokenSrc });
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to save the Token Creator project`, error);
      projectNote = localize(
        'Creator.ProjectSaveFailed',
        'The token was saved, but its project could not be saved for later editing.',
      );
    }

    const candidate = buildCreatedTokenCandidate({
      label,
      tokenSrc,
      portraitSrc,
      subjectSrc,
      ringColors,
      ringEffects: ringMode ? app.creatorOptions.ringEffects : undefined,
      breakoutScale: 1 / getActiveRingScale(app),
      animated,
      projectSrc,
    });
    if (action) {
      await applyCreatedTokenCandidate(action, candidate, app.tokenDocument);
      app.onApplied?.(candidate);
    } else {
      globalThis.ui?.notifications?.info?.(
        portraitEdited
          ? localize(
              'Creator.SavedWithPortrait',
              'Tokener: token and portrait saved to {path}.',
            ).replace('{path}', folder)
          : localize('Creator.Saved', 'Tokener: token saved to {path}.').replace(
              '{path}',
              tokenSrc,
            ),
      );
    }
    const notes = [portraitNote, projectNote].filter(Boolean);
    setCreatorStatus(
      app,
      notes.length ? `${tokenSrc} — ${notes.join(' ')}` : tokenSrc,
      Boolean(projectNote),
    );
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to create token`, error);
    setCreatorStatus(app, localize('Creator.SaveFailed', 'Failed to save the token.'), true);
    globalThis.ui?.notifications?.error?.(
      localize('Creator.SaveFailedNotification', 'Tokener: failed to save the created token.'),
    );
  } finally {
    setCreatorBusy(app, false);
  }
}

/**
 * Everything a Token Creator project stores, frozen at save start. Sources are kept by
 * reference (they are replaced, never drawn into); masks and regions are painted in place, so
 * they are copied.
 */
export function snapshotProjectState(app) {
  const token = app.workspaces.token;
  const portrait = app.workspaces.portrait?.source ? app.workspaces.portrait : null;
  const cleanup = (workspace) => ({
    keep: copyCanvas(workspace.cleanup?.keep),
    remove: copyCanvas(workspace.cleanup?.remove),
  });
  // A source without a path is uploaded un-flipped (getProjectSourceCanvas), so every
  // source records its real flip.
  const flip = (source) => normalizeFlip(source?.flip);
  return {
    label: token.source?.label ?? '',
    options: structuredClone(app.creatorOptions),
    token: {
      source: token.source,
      view: { ...app.view },
      flip: flip(token.source),
      popOutMask: copyCanvas(app.popOutMask),
      cleanup: cleanup(token),
    },
    portrait: portrait
      ? {
          source: portrait.source,
          view: { ...app.portraitView },
          flip: flip(portrait.source),
          popOutMask: null,
          cleanup: cleanup(portrait),
        }
      : null,
    portraitView: { ...app.portraitView },
    animation: structuredClone(app.animation),
    regions: Object.fromEntries(
      Object.entries(app.effectRegions ?? {}).map(([key, canvas]) => [key, copyCanvas(canvas)]),
    ),
  };
}

/**
 * Writes `<stem>.tokener.json` next to the saved token and returns its path. Sources without a
 * path (file, paste, drop, generated) are uploaded first as lossless `<stem>-source.png` (and
 * `<stem>-portrait-source.png` for a separate portrait image) so the project can reload them.
 */
async function saveCreatorProject(state, { folder, tokenSrc }) {
  if (!state) throw new Error('No project snapshot.');
  const tokenFileName = String(tokenSrc).split('/').pop();
  const stem = tokenFileName.replace(/\.[^.]+$/, '');
  const uploadSource = async (source, fileName) =>
    source.path ||
    uploadBlob(await canvasToBlob(getProjectSourceCanvas(source), 'image/png'), folder, fileName);
  const tokenPath = await uploadSource(state.token.source, `${stem}-source.png`);
  let portraitPath = null;
  if (state.portrait)
    portraitPath =
      state.portrait.source === state.token.source
        ? tokenPath
        : await uploadSource(state.portrait.source, `${stem}-portrait-source.png`);
  const project = serializeProjectSnapshot(state, {
    tokenPath,
    portraitPath,
    output: tokenSrc,
    toDataUrl: (canvas) => canvas.toDataURL('image/png'),
  });
  return uploadBlob(
    new Blob([JSON.stringify(project)], { type: 'application/json' }),
    folder,
    buildProjectFileName(tokenFileName),
  );
}

/** The source image as it was given, before any flip: what a project stores and reloads. */
export function getProjectSourceCanvas(source) {
  return applyFlip(source.canvas, source.flip, createCanvas);
}

/**
 * The project object for a snapshot whose sources are stored at `tokenPath` / `portraitPath`
 * (the portrait path only matters while the portrait has its own workspace).
 */
export function serializeProjectSnapshot(state, { tokenPath, portraitPath, output, toDataUrl }) {
  return serializeProject({
    label: state.label,
    output,
    options: state.options,
    token: { ...state.token, sourcePath: tokenPath },
    portrait: state.portrait ? { ...state.portrait, sourcePath: portraitPath } : null,
    portraitView: state.portraitView,
    animation: state.animation,
    regions: state.regions,
    toDataUrl,
  });
}

/** Frames rendered between yields to the browser while an animation is prepared. */
const ANIMATION_FRAMES_PER_YIELD = 4;

/** Copies a canvas, so later edits to the original cannot reach a save in progress. */
function copyCanvas(source) {
  if (!source) return null;
  const canvas = createCanvas(source.width, source.height);
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

/**
 * Everything `drawCreatedToken` reads for a bent token frame, frozen at save start: the pose,
 * cut-out, pop-out image and options cannot change while frames render across yields.
 */
function snapshotTokenAnimation(app) {
  return withEditTarget(app, 'token', () => ({
    snapshot: {
      editTarget: 'token',
      creatorOptions: { ...app.creatorOptions },
      cutout: copyCanvas(app.cutout),
      view: { ...app.view },
      ringAssets: app.ringAssets,
      tokenDocument: app.tokenDocument,
      popOutMask: null,
    },
    popOutImage: isPopOutEnabled(app) ? copyCanvas(getPopOutImage(app)) : null,
    regions: Object.fromEntries(
      Object.entries(app.effectRegions ?? {}).map(([key, canvas]) => [key, copyCanvas(canvas)]),
    ),
    animation: structuredClone(app.animation),
  }));
}

/**
 * Renders every loop frame of the token (bent art under a still frame or ring) at `size` and
 * encodes them into a transparent looping WebM. `size` is already capped by
 * `getAnimatedOutputSize`; the bitrate follows it. The status line counts the rendered frames.
 */
async function encodeTokenAnimation(app, size) {
  const { snapshot, popOutImage, regions, animation } = snapshotTokenAnimation(app);
  const times = getFrameTimes(animation);
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  for (const [index, t] of times.entries()) {
    setCreatorStatus(app, getEncodingStatus(index, times.length));
    context.clearRect(0, 0, size, size);
    renderAnimationFrame({
      context,
      size,
      t,
      art: { cutout: snapshot.cutout, popOutImage, regions },
      view: snapshot.view,
      animation,
      createCanvas,
      drawFrame: (frameContext, bent) => drawCreatedToken(frameContext, snapshot, size, { bent }),
    });
    frames.push(context.getImageData(0, 0, size, size));
    if ((index + 1) % ANIMATION_FRAMES_PER_YIELD === 0) await yieldToBrowser();
  }
  setCreatorStatus(app, getEncodingStatus(times.length, times.length));
  await yieldToBrowser();
  return encodeAlphaWebm({
    frames,
    width: size,
    height: size,
    fps: animation.fps,
    durationMs: animation.duration * 1000,
    bitrate: size * size * 8,
  });
}

/** Frame rate of animated portraits (animated WebP); lower than the token's to keep files small. */
const PORTRAIT_ANIMATION_FPS = 15;
const PORTRAIT_ANIMATION_QUALITY = 0.85;
/** Longest side of an animated portrait, in pixels. */
const MAX_ANIMATED_PORTRAIT_SIZE = 512;

/**
 * Whether the saved portrait is an animated WebP: only when asked for, when the portrait shares
 * the token's image (pins and effects live in that image's pixel space), when the token animation
 * moves, and when this browser can encode WebP.
 */
export function getPortraitAnimationPlan({
  options,
  sharedSource,
  hasActiveMotion: moving,
  canEncodeWebp: canEncode,
} = {}) {
  return options?.animatePortrait && sharedSource && moving && canEncode ? 'animated' : 'still';
}

/** Everything but WebP support: what the Animate portrait checkbox asks for applies now. */
function wantsPortraitAnimation(app) {
  return (
    getPortraitAnimationPlan({
      options: app.creatorOptions,
      sharedSource: isPortraitShared(app),
      hasActiveMotion: hasActiveMotion(app.animation, app.effectRegions),
      canEncodeWebp: true,
    }) === 'animated'
  );
}

/** The portrait size `width` x `height` scaled down (never up) to `MAX_ANIMATED_PORTRAIT_SIZE`. */
export function getAnimatedPortraitSize(width, height) {
  const scale = Math.min(1, MAX_ANIMATED_PORTRAIT_SIZE / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The portrait has no image of its own (or the same one), so it can follow the token animation. */
function isPortraitShared(app) {
  const portrait = app.workspaces?.portrait;
  return !portrait || portrait.source === app.workspaces?.token?.source;
}

/** Whether `canvas.toBlob('image/webp')` really gives WebP here (some browsers fall back to PNG). */
async function canEncodeWebp() {
  try {
    const blob = await canvasToBlob(createCanvas(1, 1), 'image/webp', PORTRAIT_ANIMATION_QUALITY);
    if (blob.type && blob.type !== 'image/webp') return false;
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    return String.fromCharCode(...head.subarray(0, 4), ...head.subarray(8, 12)) === 'RIFFWEBP';
  } catch {
    return false;
  }
}

/**
 * Renders the animation loop through the portrait layout (`drawPortrait` geometry: aspect, zoom,
 * offset, background; no frame or ring) at the portrait size capped to 512 px, 15 fps, and encodes
 * it as an animated WebP. Null when WebP cannot be encoded.
 */
async function encodePortraitAnimation(app) {
  const { image, background, color, regions, animation, view } = withEditTarget(
    app,
    'portrait',
    () => ({
      image: copyCanvas(
        app.creatorOptions.portraitBackground === 'original' ? app.source.canvas : app.cutout,
      ),
      background: app.creatorOptions.portraitBackground,
      color: app.creatorOptions.portraitColor,
      regions: Object.fromEntries(
        Object.entries(app.effectRegions ?? {}).map(([key, canvas]) => [key, copyCanvas(canvas)]),
      ),
      animation: structuredClone(app.animation),
      view: { ...app.portraitView },
    }),
  );
  const ratio = getPortraitAspectRatio(
    app.creatorOptions.portraitAspect,
    image.width,
    image.height,
  );
  const longSide = Math.max(image.width, image.height);
  const { width, height } = getAnimatedPortraitSize(
    Math.round(ratio >= 1 ? longSide : longSide * ratio),
    Math.round(ratio >= 1 ? longSide / ratio : longSide),
  );
  const times = getFrameTimes({ ...animation, fps: PORTRAIT_ANIMATION_FPS });
  const output = createCanvas(width, height);
  // One canvas redrawn per frame: each frame is encoded before the next is drawn.
  const frames = (function* () {
    for (const t of times) {
      renderPortraitAnimationFrame(output, {
        image,
        regions,
        animation,
        view,
        background,
        color,
        t,
      });
      yield output;
    }
  })();
  return encodeAnimatedWebp(
    frames,
    { fps: PORTRAIT_ANIMATION_FPS, quality: PORTRAIT_ANIMATION_QUALITY },
    {
      total: times.length,
      onFrame: (done, total) =>
        setCreatorStatus(
          app,
          localize('Creator.AnimatePortraitEncoding', 'Encoding animated portrait… {n}/{total}')
            .replace('{n}', String(done))
            .replace('{total}', String(total)),
        ),
      yield: yieldToBrowser,
      yieldEvery: ANIMATION_FRAMES_PER_YIELD,
    },
  );
}

/**
 * One portrait frame at loop time `t` into `output` (the portrait size). The animation renderer
 * works on a square, so the frame is rendered on a square as large as the portrait's long side,
 * with the art laid out so the centred portrait rect matches `drawPortrait` exactly, then cropped.
 * The portrait `background` is 'original' (`image` is the source), 'transparent' or 'color'.
 */
export function renderPortraitAnimationFrame(
  output,
  { image, regions, animation, view, background, color, t },
) {
  const { width, height } = output;
  const size = Math.max(width, height);
  const left = (size - width) / 2;
  const top = (size - height) / 2;
  const portraitScale =
    Math.max(width / Math.max(1, image.width), height / Math.max(1, image.height)) *
    (Number(view?.zoom) || 1);
  const squareCover = size / Math.max(1, Math.min(image.width, image.height));
  const squareView = {
    zoom: portraitScale / squareCover,
    offsetX: ((Number(view?.offsetX) || 0) * width) / size,
    offsetY: ((Number(view?.offsetY) || 0) * height) / size,
  };
  const square = createCanvas(size, size);
  renderAnimationFrame({
    context: square.getContext('2d'),
    size,
    t,
    art: { cutout: image, popOutImage: null, regions },
    view: squareView,
    animation,
    createCanvas,
    drawFrame: (frameContext, bent) => {
      if (background === 'color') {
        frameContext.fillStyle = color;
        frameContext.fillRect(left, top, width, height);
      }
      if (bent) {
        frameContext.drawImage(bent.art, 0, 0, size, size);
        return;
      }
      const layout = getTokenFrameLayout({
        imageWidth: image.width,
        imageHeight: image.height,
        size,
        zoom: squareView.zoom,
        offsetX: squareView.offsetX * size,
        offsetY: squareView.offsetY * size,
      });
      frameContext.drawImage(image, layout.x, layout.y, layout.width, layout.height);
    },
  });
  const outputContext = output.getContext('2d');
  outputContext.clearRect(0, 0, width, height);
  outputContext.drawImage(square, -left, -top);
}

function getEncodingStatus(done, total) {
  return localize('Creator.Animate.Encoding', 'Encoding animation… {n}/{total}')
    .replace('{n}', String(done))
    .replace('{total}', String(total));
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function uploadCanvas(canvas, folder, fileName) {
  return uploadBlob(await canvasToBlob(canvas, 'image/webp', 0.92), folder, fileName);
}

async function uploadBlob(blob, folder, fileName) {
  const FilePicker = getFilePickerImplementation();
  if (!FilePicker?.upload) throw new Error('FilePicker upload is unavailable.');
  const file = new File([blob], fileName, { type: blob.type || 'image/webp' });
  const response = await FilePicker.upload('data', folder, file, {}, { notify: false });
  if (response?.status === 'error' || response === false)
    throw new Error(response?.message ?? 'Upload failed.');
  return response?.path ?? `${folder}/${fileName}`;
}

async function ensureDataFolder(folder) {
  const FilePicker = getFilePickerImplementation();
  if (!FilePicker?.browse) return;
  try {
    await FilePicker.browse('data', folder);
    return;
  } catch {}

  const parts = folder.split('/').filter(Boolean);
  for (let index = 1; index <= parts.length; index += 1) {
    const path = parts.slice(0, index).join('/');
    try {
      await FilePicker.browse('data', path);
    } catch {
      await FilePicker.createDirectory('data', path, {});
    }
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed.'))),
      type,
      quality,
    );
  });
}

function createCanvas(width, height) {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function setCreatorZoom(app, zoom) {
  getActiveView(app).zoom = clamp(numberOr(zoom, 1), ZOOM_MIN, ZOOM_MAX);
  syncZoomInput(app);
  renderCreatorPreview(app);
}

function syncZoomInput(app) {
  const input = getCreatorRoot(app)?.querySelector('input[name="zoom"]');
  if (!input) return;
  input.value = String(getActiveView(app).zoom);
  updateValueLabel(input);
}

function syncFrameControls(app) {
  const root = getCreatorRoot(app);
  root
    ?.querySelector('.pf2e-tokener-creator-frame')
    ?.setAttribute('data-style', app.creatorOptions.frameStyle);
  getCreatorSection(app)?.setAttribute(
    'data-pop-out',
    app.creatorOptions.popOut ? 'true' : 'false',
  );
}

function syncBackgroundControls(app) {
  const root = getCreatorRoot(app);
  root
    ?.querySelector('.pf2e-tokener-creator-background')
    ?.setAttribute('data-mode', app.creatorOptions.backgroundMode);
}

function updateCreatorOption(app, input) {
  const value = input.type === 'checkbox' ? input.checked : input.value;
  const path = getCreatorOptionKey(input.name, app.creatorOptions);
  if (!path) return;
  app.creatorOptions = normalizeTokenCreatorOptions(
    path.key
      ? {
          ...app.creatorOptions,
          [path.group]: { ...app.creatorOptions[path.group], [path.key]: value },
        }
      : { ...app.creatorOptions, [path.group]: value },
  );
}

const NESTED_OPTION_GROUPS = Object.freeze(['ringEffects']);

/**
 * Maps an input name to the creator option it edits: a flat option name, or `group.key` for a
 * whitelisted nested group such as `ringEffects.pulse`. Anything else is not an option.
 */
export function getCreatorOptionKey(name, options = {}) {
  if (typeof name !== 'string' || !name) return null;
  if (!name.includes('.')) return name in options ? { group: name, key: null } : null;
  const [group, key, ...rest] = name.split('.');
  if (rest.length || !NESTED_OPTION_GROUPS.includes(group)) return null;
  const nested = options[group];
  if (!nested || typeof nested !== 'object' || !(key in nested)) return null;
  return { group, key };
}

function updateValueLabel(input) {
  const label = input
    .closest?.('.pf2e-tokener-creator-slider')
    ?.querySelector('.pf2e-tokener-creator-value');
  if (!label) return;
  if (input.name === 'zoom') label.textContent = formatZoom(input.value);
  else if (input.name === 'brushSize') label.textContent = `${input.value}px`;
  else if (input.name === 'breakoutRoom') label.textContent = `${input.value}%`;
  else label.textContent = input.value;
}

function formatZoom(value) {
  return `${Number(value).toFixed(2)}x`;
}

/** `value` escaped for a quoted attribute selector (`CSS.escape` when the browser has it). */
export function escapeSelectorValue(value) {
  const text = String(value ?? '');
  if (typeof globalThis.CSS?.escape === 'function') return globalThis.CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, ' ');
}

function setCreatorStatus(app, message, isError = false) {
  const status = getCreatorRoot(app)?.querySelector('.pf2e-tokener-creator-status');
  if (!status) return;
  status.textContent = message ?? '';
  status.classList.toggle('is-error', Boolean(isError));
}

function setCreatorBusy(app, busy) {
  app.busy = busy;
  getCreatorRoot(app)
    ?.querySelectorAll('[data-creator-action]')
    .forEach((button) => (button.disabled = busy));
  if (!busy) syncAnimationControls(app);
}

function getCreatorRoot(app) {
  return normalizeHudElement(app?.parts?.main) ?? normalizeHudElement(app?.element);
}

/** The Animate card, which holds playback, the timeline and the presets. */
export function getAnimationSection(app) {
  return getCreatorRoot(app)?.querySelector?.('.pf2e-tokener-creator-animate') ?? null;
}

/** The template's top-level section, which may be the part element itself rather than a child. */
export function getCreatorSection(app) {
  const root = getCreatorRoot(app);
  if (root?.matches?.('.pf2e-tokener-creator')) return root;
  return root?.querySelector?.('.pf2e-tokener-creator') ?? null;
}

function deriveSourceLabel(app, path, file) {
  const actorName = getDocumentActor(app.tokenDocument)?.name;
  if (actorName) return actorName;
  const name =
    file?.name ??
    String(path ?? '')
      .split('/')
      .pop() ??
    '';
  return decodeURIComponent(name).replace(/\.[^.]+$/, '');
}

function isDefaultArtwork(path) {
  return /^icons\/svg\/mystery-man|^systems\/[^/]+\/icons\/default-icons\//.test(String(path));
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value).toLowerCase() : fallback;
}

function readCreatorDefaults() {
  return readSetting(TOKEN_CREATOR_DEFAULTS_SETTING_KEY) ?? {};
}

function saveCreatorDefaults(options) {
  try {
    void globalThis.game?.settings?.set?.(MODULE_ID, TOKEN_CREATOR_DEFAULTS_SETTING_KEY, options);
  } catch {}
}

/** Registers the configured created token folder as a ring subject path (see ring-video.js). */
export function syncCreatedTokenSubjectPath() {
  return registerCreatedTokenSubjectPath(
    getCreatedTokenFolder({
      worldId: globalThis.game?.world?.id,
      configured: readSetting(CREATED_TOKEN_FOLDER_SETTING_KEY),
    }),
  );
}

function readSetting(key) {
  try {
    return globalThis.game?.settings?.get?.(MODULE_ID, key);
  } catch {
    return undefined;
  }
}

function getFilePickerImplementation() {
  return (
    globalThis.foundry?.applications?.apps?.FilePicker?.implementation ??
    globalThis.FilePicker ??
    null
  );
}
