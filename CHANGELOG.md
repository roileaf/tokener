# Changelog

## Unreleased

### Changed

- **Remove** and **Restore** are now one **Touch-up brush** (**Q**): drag removes leftovers, right-drag or Alt-drag brings the original back (**R** still starts it in restore mode and **X** swaps).
- **Paint** and **Erase** are now one **Pop-out brush** (**B**): drag to pop parts out, right-drag or Alt-drag to keep them inside (**E** still starts it in keep-inside mode and **X** swaps). The brush only works outside the frame opening, so strokes can cross the frame edge freely, and the outline and tint of popped parts are shown only where they actually pop out.

### Added

- Animation studio, motion: Shift+click selects several pins (Escape clears the selection with the pin tool); each keyframe has an easing (**Smooth**, **Linear**, **Hold**) and a rotation (-45 to 45 degrees) so pins can tilt parts of the art; playback can **Loop** or **Ping-pong** (presets and Auto animate applied in Ping-pong swing over the forward half; switching the mode keeps existing keyframes).
- New presets **Flap**, **Wave**, **Hover**, **Shiver** and **Look** beside **Bob**, **Sway** and **Breathe**. Bob, Sway, Look, Shiver and Flap act on the selected pins, **Wave** on 2+ selected pins in selection order with follow-through delay, **Breathe** needs 2+ pins, and Breathe and Hover move all pins.
- **Auto animate** places pins (head, chest, two base anchors, up to two limb or weapon tips) and an idle: Breathe on the head and chest, Bob on the head, Flap or Sway on the tips; anchors stay still.
- **Effects** in the Animate card: **Wind**, **Wobble**, **Flicker**, **Glow** and **Particles** (embers, smoke, sparkles, snow, drips). Flicker covers the whole figure; the others apply to the whole figure or a painted region (region brush **F**: drag paints, right-drag or Alt-drag removes), and do nothing until that region is painted. **Glow** on the whole figure is an aura behind the art inside the frame; on a painted region (such as eyes) it glows on top. Particles start from the art's rest pose (they do not follow pin bends). All effects loop seamlessly, and tokens with active effects save as an animated WebM. A new token image starts a fresh animation (pins and effects are cleared).
- **Ring effects** in the Frame card (dynamic token ring): **Pulse**, **Gradient**, **Background wave** and **Spectral**, Foundry's built-in ring effects. They work on still tokens and need no video or https. The ticked effects are applied to the ring; none ticked turns them off.
- Projects: every save also writes `<token>.tokener.json` next to the token (sources added by upload or paste are saved as `<token>-source.png`) and the token or prototype remembers it. Opening the creator on that token reloads the full project (images, framing, options, masks, touch-ups, pins, effects, regions) while the token still shows that art. **Open project** in the Image card loads any project file, for example after **Save only**. If a project cannot be loaded the creator stays as it was and shows why; a failed project save never blocks the token save.
- **Flip horizontal** and **Flip vertical** in the Image card mirror the token or portrait image being edited, together with its cut-out, touch-ups, pop-out mask, effect regions and pins, so nothing has to be redone. In Portrait mode a portrait linked to the token image flips the token too, while a **Separate image** portrait flips on its own. A flipped image is saved as a rendered portrait (the original file is not mirrored). Projects remember the flips.
- Tokener opens instantly: the picker shows a loading state while the art index is built, the index warms up in the background once the world has loaded, and it is cached in the browser (IndexedDB) until the installed modules or their versions, the custom folder settings, the image tag overrides or Tokener itself change. Art added any other way (for example new files in an existing folder) appears after **Rescan** in the picker sidebar. A failed build shows no art and is retried the next time the picker opens.
- **Animate portrait** in the Portrait card (shown when the token animation moves): Actor, Portrait, Both and Save only also save the portrait as an animated WebP (`<token>-portrait.webp`, 15 fps, up to 512 px on the long side) that plays the token animation in the portrait's shape, framing and background, so character sheets show it moving. Only a portrait that shows the token's image (linked, or a separate portrait without its own image or flip) can be animated, and only while the token animation is available. With the original background the uncut image bends behind the figure, and glow and particles follow the figure. Browsers that cannot encode WebP, or an animated portrait that fails to encode, save the still portrait and say so.
- **Move a region** in the Animate card: select a pin and paint the part it moves (a wing, a tail, a raised weapon). The whole painted area then shifts and turns with that pin as one solid piece, blending into the art around it, instead of only bending the art near the pin. Region pins show as squares; **Plain pin** turns one back into a bending pin. Regions are saved with the project and can be undone like other brush strokes.
- **Lasso a region** next to it: draw an outline around the part instead of painting it, and everything inside joins the pin's region. A right or Alt drag cuts the outline back out. Each outline undoes in one step.

### Fixed

- **Effects stay inside the ring**: particles and region glow no longer drift outside the token's ring or frame into the empty space around it.
- **No ring line through popped-out parts**: a wing or horn breaking out of the ring no longer shows a faint outline of the ring's inner edge across it.
- **Auto animate** gives each part its own motion instead of one shared move: raised parts (horns, a held weapon) sway side to side, wings flap together, and tails swing across their length. Parts trail the body by different amounts and the head bobs a beat after the chest breathes, so the figure no longer moves in lockstep. Farther tips move more.
- **Auto animate** no longer leaves every pin selected, so the next preset you click only moves the pins you pick, and it no longer puts both tip pins on one part when the frame cuts that part twice (two wings now flap as a pair).

## 2.3.1 - 2026-10-30

### Fixed

- Fixed a visible line across pop-out tokens just below the centre: art above the automatic pop-out line was drawn a second time inside the frame, so semi-transparent parts (soft edges, wings, AI cut-outs) looked denser there, and the pop-out shadow darkened the art below the line. Popped parts and their shadow are now drawn only outside the frame opening.

## 2.3.0 - 2026-10-30

### Added

- Animated tokens: in the Token Creator, the new **Pin** tool (**P**) pins parts of the art and the **Animate** card keyframes them or applies the **Bob**, **Sway** and **Breathe** presets over a 1-4 s loop. Tokens with moving pins save as a transparent looping WebM (up to 512 px) instead of a still WebP, and work with the painted frame, pop-out and the dynamic token ring (Tokener also plays ring subject videos Foundry leaves paused). The preview pauses while a mask or touch-up tool is in use; **Breathe** also moves anchor pins and needs at least two pins. Needs Foundry opened over https or on localhost and a browser that can encode VP9.
- Optional AI ranking for **Auto compose** (AI tools only): a small rim-occlusion model (about 670 KB, shipped with the module, plain JavaScript, non-generative) adds a small advisory bonus to each layout's score. If the model cannot load, Auto compose keeps its usual ranking.

## 2.2.1 - 2026-10-27

### Added

- New client setting **Show Token HUD button** hides the Tokener button from the Token HUD for users who only open Tokener from the actor sheet or actor directory ([#4](https://github.com/roileaf/tokener/issues/4)).
- Token art is now found in modules that keep it under `pictures/`, as the German PF2e modules do: `pictures/tokens` and `pictures/portraits`, and one folder deeper such as `pictures/book-of-the-dead/tokens` ([#3](https://github.com/roileaf/tokener/issues/3)).

## 2.2.0 - 2026-10-27

### Added

- Added a Token Creator, opened from the **Create token** button in the Tokener picker. Load art from Foundry files, your computer, the actor portrait, drag-and-drop or the clipboard, then drag and scroll to frame it.
- Automatic background removal samples the backdrop around the top corners and flood-fills it away, with tolerance and edge-softness controls. An optional AI mode downloads a background removal model in the browser on first use, and falls back to the original image if it cannot load. AI tools are off by default and only appear once a GM turns on the new **Enable AI-assisted tools** world setting.
- Two frame styles: a painted border (colour, width, optional fill and a pop-out effect that lets the cut-out break over the top of the frame) or a **Dynamic token ring** subject that enables Foundry's ring with optional ring and background colours. The ring preview uses the world's configured ring art (core steel, bronze or a module's ring) and colouring, and the subject is clipped to the ring's inner edge so the ring stays visible, with optional pop-out over the top.
- Pop-out masking: with **Pop out of frame** on, use **Paint** and **Erase** brushes on the preview to choose exactly which parts of the cut-out break out of the painted frame or dynamic ring. **Auto** restores the default area above the frame opening and **Clear** removes all pop-out. The mask follows the art when you move or zoom it.
- Mask shortcuts: Shift-drag paints and Alt-drag or right-drag erases from any tool, **B**/**E**/**V** switch between paint, erase and move, **[**/**]** or Ctrl+wheel resize the brush, **A** resets to Auto and Ctrl+Z / Ctrl+Shift+Z undo and redo. A brush outline follows the pointer. While a mask tool is active the whole cut-out is ghosted behind the frame and the parts that pop out are outlined in gold, so you can see exactly what you are adding or removing.
- **Auto compose** (Token mode): one click reads the cut-out, finds the head (even under raised weapons, spiky hair or a beard), tries several framings and pop-out choices, scores them on head placement and size, frame fill, tasteful pop-out and awkward cuts, applies the best and shows the top four as thumbnails to pick from. With AI tools enabled, long popped parts (weapons, staves, horns) are completed with click-to-select so the whole part pops out. Everything stays editable and undoable.
- **Breakout room** for pop-outs: with **Pop out of frame** on, the frame or dynamic ring is drawn smaller inside the token (0–50% extra room, 25% by default) so swords, fists, hair and wings can reach past its outer edge instead of stopping at it. On apply the token is enlarged by the same amount on top of its normal scale (a small creature stays at 0.8), so the frame or ring keeps the size it would have without breakout. PF2e size autoscale is paused while breakout art is applied, since it would otherwise reset the enlargement, and is restored when other art replaces it. Auto compose plans layouts with the frame at its smallest, gives each layout just the room its popped parts need (so a raised sword is not cut flat by the token edge, and layouts with nothing popped get no room), and adds a full breakout choice that also pops out side parts. Parts already cut off by the edge of the source picture are left inside the frame, where the frame hides the cut.
- Popped parts cast a soft shadow onto the frame or ring and the map around the token (**Shadow under popped parts**, on by default), so they read as in front of it.
- Dynamic ring subjects now stop exactly where the world's ring art begins, measured from the ring texture itself. Clipping at the ring's colour band left a dark gap on rings whose band starts inside the art (the core bronze ring: band at 0.60, art at about 0.675).
- Separate token and portrait images: in Portrait mode choose **Image: Separate image** and load a different picture for the portrait, with its own background removal, touch-ups and framing. **Actor** and **Both** then save each target from its own image. In Token mode, **From portrait** turns the finished, edited portrait into the token's image so you can frame it as a token while the portrait keeps its own.
- Manual background touch-ups: **Remove** (Q) and **Restore** (R) brushes paint background away or bring original pixels back, and **Fill remove** (G) clicks away a connected patch of similar colour (right-click or Alt-click restores one). While a touch-up tool is active the removed parts show faded red. Touch-ups work in Token and Portrait mode, survive changes to tolerance or removal mode, share undo/redo with the pop-out mask, and **Reset touch-ups** clears them.
- Smarter automatic pop-out: instead of a fixed column above the frame, Auto now pops out every part of the cut-out above a line just below the token centre, so hair, horns, ears, wings and raised weapons break out while the lower body stays cropped.
- Click-to-select pop-out (AI tools only): the **Select** tool (**W**) uses a Segment Anything model (SlimSAM, Apache-2.0, ~14 MB, downloaded on first use) to pick out the part you click and add it to the pop-out; right-click or Alt-click removes a part. The image is analysed once, then each click takes a fraction of a second. Analysis starts as soon as you pick the tool, the status line shows download progress, and the model is cached by the browser (on https or localhost) so later sessions skip the download.
- Portrait editing: switch the Token Creator between **Token** and **Portrait** to frame the same art as a portrait with its own zoom and position, in its original shape or 1:1, 2:3 or 3:4, on the original backdrop, transparent (the cut-out) or a solid colour. **Actor**, **Portrait** and **Both** save the edited portrait; if you never change it, the original image is used as before.
- View zoom for the Token Creator preview (40%–400%) that only changes how large the editor shows the token, not the token itself: use the magnifier buttons, **-** / **=** / **0** or Alt+wheel, and middle-drag to pan. Zoomed out, the art outside the token is shown dimmed with a dashed outline of the token edges.
- Bigger Token Creator work area (480px preview) with the shortcut list folded into a **Shortcuts** section.
- The Token Creator uses the same dark cards, buttons, segmented toggles and checkboxes as the picker.
- Created tokens are saved as WebP to `worlds/<world>/tokener` (configurable with the new **Created token folder** setting) and can be applied to the token, actor or both with the usual revert history. Ring colour changes are now captured and restored by revert.

## 2.1.7 - 2026-09-21

### Fixed

- Fixed a ghost token image appearing on the canvas where a token had previously been placed after changing an actor's art from the sidebar or sheet. Foundry keeps unsaved drop previews registered as actor dependents, and PF2e redrew them on art changes; Tokener now prunes stale dependents before updating the actor.

## 2.1.6 - 2026-09-17

### Improved

- Deferred token art indexing until the Tokener picker is first opened so catalog discovery no longer stalls canvas startup or movement.
- Added bounded concurrent module scanning while preserving candidate order and results, substantially reducing large catalog build times.

## 2.1.5 - 2026-09-17

### Fixed

- Fixed portrait-only changes replacing an actor's default token art when Foundry automatically synchronized default artwork.
- Fixed portrait-only history restores changing the actor's default token art.

## 2.1.4 - 2026-05-31

### New

- Added multi-step token art history so repeated Tokener changes can be reverted one step at a time or restored from a history dialog.
- Added thumbnail previews and art names to the Tokener history dialog.
- Added Shift + right-click on the Token HUD button to restore the original token art when multiple history entries exist.

## 2.1.3 - 2026-05-29

### New

- Added a client-side token browser grid size slider so art thumbnails can be resized from the picker.

## 2.1.2 - 2026-05-26

### Fixed

- Fixed single-image previews so square token art stays centered in a square frame instead of stretching across the full preview width.

## 2.1.1 - 2026-05-23

### Fixed

- Fixed player-owned Token HUD access behind a GM-configurable world setting.

## 2.1.0 - 2026-05-23

### New

- Added a Tokener button to actor sheet images plus actor directory/sidebar actor controls.
- Added per-image import/export JSON for GM-added image tags in the image tag editor.

### Improved

- Token art scale controls now default to the current scene token scale or actor prototype token scale.
- Per-image tag JSON now exports only custom GM tags so it can be imported onto any image.

### Fixed

- Fixed image previews that could open without a visible image when token art was unavailable.
- Fixed failed card previews retargeting image-tag edits to the wrong art source.

## 2.0.0 - 2026-05-10

### New

- Added system profiles so native compendium art mappings are read from the active system id.
- Added system-agnostic module startup while keeping PF2e legacy mapping support in the PF2e profile.

### Improved

- Rebranded the visible module name to Tokener while keeping the `pf2e-tokener` module id for compatibility.
- Removed the PF2e-only manifest system relationship so the module can be enabled in other systems.

## 1.0.7 - 2026-05-08

### New

- Added separate per-card token scale and dynamic ring scale sliders with live selected-token preview.
- Added reset buttons for both scale sliders.

### Improved

- The dynamic ring scale slider only appears for token art that uses a dynamic ring subject.
- Removed scale slider hover tooltips so they no longer cover the slider value text.

## 1.0.6 - 2026-05-07

### Fixed

- Preserved the picker result scroll position after applying token art.

## 1.0.5 - 2026-05-07

### New

- Added GM image tag overrides for all token art sources while keeping original source tags read-only.

### Fixed

- Preserved the picker result scroll position after saving image tags and changing tag filters.

## 1.0.4 - 2026-05-07

### New

- Added two-folder dynamic token support so custom folder artwork can also supply the dynamic token subject image.

## 1.0.3 - 2026-05-07

### New

- Added a DialogV2 custom token folder settings menu with folder picker support.
- Added source-level tag assignment for custom folders using the indexed tag categories from the token picker.
- Added custom folder structure support with searchable `folder:*` tags from nested custom art folders.
- Added a custom folder browser that previews image thumbnails while choosing custom folder sources.
- Added custom GM-defined image tag groups and values for custom folder art.
- Added advanced custom folder paths for separate token, portrait/artwork, and dynamic token subject folders.

### Improved

- Styled the custom folder tag selector as compact grouped controls.
- Custom folder tags now apply to every indexed token image from that folder.

### Fixed

- Custom folder settings now preserve structured tagged folder entries while remaining compatible with legacy plain path settings.

## 1.0.2 - 2026-05-07

### New

- Added a DialogV2 custom token folder settings menu with folder picker support.
- Added source-level tag assignment for custom folders using the indexed tag categories from the token picker.

### Improved

- Styled the custom folder tag selector as compact grouped controls.
- Custom folder tags now apply to every indexed token image from that folder.

### Fixed

- Custom folder settings now preserve structured tagged folder entries while remaining compatible with legacy plain path settings.

## 1.0.1 - 2026-05-06

### New

- Added favorites for token art results.
- Added a star button on each result card so preferred art can be marked quickly.
- Added a `Favorites` filter beside `Tags` to show only starred art.
- Added tag exclusion so unwanted traits, gear, families, or categories can be filtered out.
- Added `Show more` paging when source, tag, or favorites browsing has more than 120 matches.
- Added associated tags to the right-click fullscreen preview.
- Added a highlighted HUD button state when the selected token or actor has a Tokener change that can be reverted.
- Added right-click revert on the highlighted HUD button.
- Favorites are saved per Foundry client, so each user can keep their own preferred art list.

### Improved

- Reworked the tag picker into a distinct `Filters` panel with grouped tag facets.
- Selecting a source, tag, excluded tag, or favorites filter with an empty search now browses matching art automatically.
- Search, sources, tags, favorites, and revert controls now live in the left sidebar so token results keep more space in the picker.
- Removed the redundant reset-tags icon button. The visible `Clear tags` button remains when tags are active.

### Fixed

- Fixed tag category chips being clipped inside the `Filters` panel.
- Fixed search results not scrolling inside the picker window.
- Fixed the picker background changing color while scrolling through long result lists.
- Fixed right-click preview tags being spaced too far apart on wide screens.

## 1.0.0 - 2026-05-05

Initial release of PF2e Tokener.

### New

- Added a PF2e Tokener button to the Token HUD.
- Added a searchable gallery for token images from enabled token art modules.
- Added support for Foundry VTT v13 and v14.
- Added support for common PF2e token packs, including Bestiaries, Monster Core, Monster Core 2, NPC Core, Character Gallery, Myth and Magic, Draconic Codex, and similar packs.
- Added support for older PF2e token art packs such as PF2e All Tokens.
- Added automatic matching for token images, actor portraits, and token ring subject art when a module provides them.
- Added `Best matches` for exact or same-name results.
- Added broader search results for related names and terms.
- Added tag-aware search for supported galleries, including searches like `ancestry:human`, `equipment:sword`, `family:warrior`, `category:humanoid`, and `tag:magic`.
- Added a visible `Tags` picker for browsing and applying tag filters without knowing the exact search syntax.
- Added a `Revert last` control to restore art from before the last Tokener action on the selected token or actor.
- Added matched tag chips on search results when tags helped find that art.
- Added multi-source filtering so you can search one token pack or several token packs at once.
- Added result counts and current-token markers.
- Added compact thumbnail cards for quick browsing.
- Added tooltips for long token names and source names.
- Added right-click fullscreen preview.
- Added side-by-side actor portrait and token image preview.
- Added close button, `Escape` close, and click-outside close for previews.
- Added a real Foundry application window for the token picker so it stays open while the canvas pans.
- Converted the token picker window to a Handlebars ApplicationV2 template for easier UI maintenance.
- Added canvas pan and zoom resilience so the picker stays usable while the scene view changes.
- Added English localization.

### Actions

- Added `Token`, which changes only the selected token on the current scene.
- Added `Actor`, which changes the actor portrait and the actor's default token art.
- Added `Portrait`, which changes only the actor portrait.
- Added `Both`, which changes the selected scene token and the actor's default token art.

### Improved

- Source filtering now searches all indexed sources, not only sources that matched the selected token first.
- Search can now find results from other enabled token packs even when the selected token came from a different source.
- Tag browsing now uses all discovered datasheet tags instead of only a short top-tag list.
- Tag browsing now has grouped categories, tag search, active tag chips, and a clear-tags button.
- Search, sources, tags, and revert controls now live in a left sidebar so token results get more of the picker window.
- Selected tags now stay as chips instead of being inserted into the main search text.
- The search box now starts empty while best matches still use the selected token automatically.
- Token datasheets are now discovered from common datasheet folders in token modules, so more installed token packs can contribute searchable tags.
- Duplicate results from the same token image are merged so the richer result is shown.
- Folder-based token images can now pick up matching actor portraits and token ring subject art when those images use the same filename.
- Character Gallery entries now show actor images when portrait art is available.
- Monster Core 2 entries now show actor images when portrait art is available.
- Result cards now show the art name and keep the source module in the tooltip.

### Fixed

- Fixed action buttons stretching every card in the same grid row.
- Fixed missing tooltips on shortened names.
- Fixed single-source dropdown limitations by replacing it with a multi-source picker.
- Fixed searches being too limited after opening the picker from a specific token.
- Fixed cases where a token result showed no actor image even though the source module had one.
- Fixed Monster Core 2 results such as Dragon Adult Phase showing token art without actor art.
- Fixed Character Gallery preview results missing actor portrait art.
- Fixed broad results repeating the selected token name on every card instead of showing each result's real name.
- Fixed result titles disappearing on non-current cards after moving the source module into the tooltip.
- Fixed fullscreen preview panes showing broken image placeholders when that side has no valid art.

### Notes

- PF2e Tokener does not include art. It uses art from enabled modules.
- Some modules only provide token images, so the fullscreen preview may show only the token image for those results.
- Utility images such as treasure, hazards, rings, point trackers, or backgrounds may not have actor portraits.
- Reload the world after enabling or disabling token art modules.
