[![Latest Version](https://img.shields.io/github/v/release/roi007leaf/pf2e-tokener?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roi007leaf//pf2e-tokener/releases/latest)
[![GitHub all releases](https://img.shields.io/github/downloads/roi007leaf/pf2e-tokener/total)](https://github.com/roi007leaf/pf2e-tokener/releases)
[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2F/pf2e-tokener)](https://forge-vtt.com/bazaar)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)
[![Patreon](https://c5.patreon.com/external/logo/become_a_patron_button.png)](https://www.patreon.com/roileaf)

# Tokener

Tokener adds a searchable token art picker to the Foundry VTT Token HUD.

Select a token, open its HUD, click the Tokener button, then search and apply art from enabled token-art modules or your own world data folders. The picker opens as a Foundry ApplicationV2 window, so it stays open while you pan or zoom the canvas.

Tokener does not include art. It indexes image files and art metadata from other enabled sources, then points selected tokens and actors at those existing images.

The internal module id remains `pf2e-tokener` so existing settings, favorites, tag overrides, and revert flags keep working.

## Feature Summary

- Token HUD button for selected tokens in any Foundry system.
- Searchable gallery of token art from enabled token-art modules.
- System-profile support for native compendium art mappings keyed by the active system id.
- PF2e compatibility profile for existing PF2e compendium art mappings and legacy `pf2e-art` mapping modules.
- Support for mapped module art, gallery datasheets, common token folders, actor portraits, and dynamic token ring subject art.
- Custom world data folders with optional source names, recursive scans, folder browser thumbnails, source-level tags, nested `folder:*` tags, and advanced split paths for token, portrait/artwork, and subject images.
- Search by actor name, creature or NPC name, filename, module/source name, broad terms, or tags.
- Multi-source filter with source search, select all, and clear all.
- Tag filters grouped by category, with include and exclude controls.
- Direct tag search syntax such as `ancestry:human`, `equipment:sword`, `tag:magic`, and `!family:undead`.
- Client-side favorites with a sidebar favorites filter.
- GM image tag overrides for any indexed image, with source tags kept read-only.
- Matched tag chips on result cards and grouped tags in fullscreen preview.
- `Token`, `Actor`, `Portrait`, and `Both` apply actions.
- Revert last Tokener change from the sidebar or by right-clicking the highlighted HUD button.
- Current-token marker, result counts, paging with `Show more`, and scroll preservation while applying art or changing filters.

## Compatibility

- Foundry VTT v13 and v14.
- System-agnostic default behavior for token folders, datasheets, custom folders, actor portraits, and token image updates.
- First-class PF2e profile for Pathfinder token packs and legacy PF2e art mappings.
- Best with enabled token art modules that use recognized token folders, datasheets, or active-system compendium art mappings.

## Supported Art Sources

Tokener builds its index when the world loads and when relevant Tokener settings change.

It can index:

- Native compendium art mappings for the active system, such as `compendiumArtMappings.dnd5e`, `compendiumArtMappings.pf2e`, or `compendiumArtMappings.sf2e`.
- Older PF2e `pf2e-art` mapping modules when the active system is PF2e.
- Gallery datasheets with searchable tags.
- Datasheet JSON files discovered in common module data folders.
- Token images in common module paths such as `tokens`, `assets/tokens`, and `resources/tokens`.
- Matching portrait art in paths such as `art`, `portraits`, `assets/art`, `assets/portraits`, `resources/art`, and `resources/portraits`.
- Matching dynamic token subject art in paths such as `subjects`, `assets/subjects`, and `resources/subjects`.
- Custom world data folders configured in the module settings.

Known compatible source styles include:

- Pathfinder Tokens: Bestiaries
- Pathfinder Tokens: Monster Core
- Pathfinder Tokens: Monster Core 2
- Pathfinder Tokens: NPC Core
- Pathfinder Tokens: Character Gallery
- Pathfinder Tokens: Myth and Magic
- Pathfinder Tokens: Draconic Codex
- Starfinder Tokens: Alien Core
- older PF2e art mapping modules such as PF2e All Tokens
- other token modules that use recognizable token folders, active-system mappings, or datasheets

Some sources only provide token images. When portrait or subject art is missing, Tokener hides unavailable panes and actions instead of showing broken image placeholders.

## Installation

1. Install Tokener in Foundry VTT.
2. Enable it in your world.
3. Enable the token art modules you want to search.
4. Reload the world.

Reload after enabling or disabling token art modules so the index can be rebuilt.

## How To Use

1. Select a token on the canvas.
2. Open the Token HUD.
3. Click the Tokener image button.
4. Search, filter, or browse matching art.
5. Click a card to reveal apply buttons.
6. Choose what to update.

Right-click a result card to open fullscreen preview.

## Apply Actions

| Button     | What It Changes                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `Token`    | Selected token on the current scene. Also applies dynamic token ring subject art when available.                |
| `Actor`    | Actor portrait and actor default token art. Also applies default dynamic token ring subject art when available. |
| `Portrait` | Actor portrait only. Uses separate portrait art when available, otherwise falls back to token art.              |
| `Both`     | Selected scene token plus actor default token art. Also updates actor portrait when portrait art is available.  |

Use `Token` for a one-time scene change.

Use `Actor` when future tokens created from that actor should use the new art.

Use `Portrait` when only the actor sheet image should change.

Use `Both` when the current scene token and future actor tokens should match.

## Reverting Changes

After applying art, Tokener stores one recent revert point for the selected token or actor.

Use `Revert last` in the sidebar to restore the previous art for the last Tokener action. When a token or actor has a revert point, the Tokener HUD button is highlighted. Right-click that highlighted HUD button to revert without opening the picker.

Revert can restore:

- selected scene token image, scale, and ring subject data
- actor default token image, scale, and ring subject data
- actor portrait

Making another Tokener change replaces the stored revert point.

## Searching And Filtering

The search box starts empty so you can type immediately. Tokener still uses the selected token behind the scenes to put exact and same-name results in `Best matches`.

You can search by:

- actor, creature, or NPC name
- token filename
- module or source name
- folder name from custom folders
- tags from supported galleries and GM overrides
- broad terms such as `dragon`, `kobold`, `guard`, or `sword`

The left sidebar includes:

- source filter with source search, select all, and clear all
- `Favorites` filter
- grouped `Filters` panel for tags
- tag search inside the filter panel
- active included and excluded tag chips
- `Clear tags`
- `Revert last` when available

Selecting a source, tag, excluded tag, or favorites filter while the main search box is empty browses all matching art. Tokener shows the first 120 results and offers `Show more` when more matches are available.

Direct tag searches work in the main search box:

- `ancestry:human`
- `equipment:sword`
- `family:warrior`
- `category:humanoid`
- `tag:magic`
- `folder:npcs`
- `!equipment:firearm`
- `-family:undead`

When a tag helps match a result, Tokener shows that matched tag on the result card.

## Favorites

Click the star on any result to mark that art as a favorite.

Use `Favorites` in the sidebar to show only starred art. Favorites are saved as a client setting, so each Foundry user keeps their own favorite list.

## Image Tag Overrides

GMs can click the tag button on a result card to edit GM-added tags for that image.

Image tag overrides:

- work on all indexed art sources, not only custom folders
- are saved as a world setting
- are searchable and filterable after the index rebuilds
- can use existing tag groups or new custom group/value pairs
- preserve original source tags as read-only tags

Original module or datasheet tags are not changed.

## Token Creator

Click **Create token** in the picker sidebar to make a new token from any image. GMs and players with the Upload Files permission can use it.

- Load art with **Browse files**, **Upload**, **Use portrait**, drag-and-drop onto the preview, or paste from the clipboard.
- Drag the preview to move the art and scroll or use the zoom slider to resize it. To look closer or further away without changing the token, use the magnifier buttons in the preview corner, **-** / **=** / **0**, or Alt+wheel, and middle-drag to pan the view.
- **Remove automatically** removes plain or gradient backdrops; tune **Tolerance** and **Edge softness** if it removes too much or too little. **AI model** handles busy backgrounds but downloads a model (~7 MB) from jsDelivr and Hugging Face the first time. AI options only appear when a GM enables **Enable AI-assisted tools** in the module settings.
- **Auto compose** (below the preview, Token mode) frames the art and chooses what pops out for you, then offers four alternatives as thumbnails; click one to switch. With AI tools enabled it completes long popped parts such as swords and staves.
- Auto removal will miss bits on busy art. Click **Touch up** (or press **Q**) and paint leftovers away with the touch-up brush; right-drag or Alt-drag with it paints the original back where too much was removed, and **Fill remove** (**G**) removes a whole patch of similar colour with one click (right-click restores). Removed parts show faded red while you work, touch-ups apply to both the token and the portrait, and **Reset touch-ups** starts over.
- **Painted border** bakes a coloured ring into the image, optionally with a fill and a pop-out effect. **Dynamic token ring** saves the transparent subject and enables Foundry's ring instead, optionally setting its colours. The preview shows the ring configured for your world in **Core Settings > Dynamic Token Ring**, at the token's size.
- **Pop out of frame** lets parts of the cut-out break over the frame or ring. By default every part of the cut-out above a line just below the token centre pops out; with AI tools enabled, the **Select** tool (**W**) lets you click a part (a sword, a wing) to pop it out and right-click to remove it; pick the **Pop-out brush** (**B**) and drag on the preview to pop parts out, or right-drag or Alt-drag to keep them inside (hair, weapons, wings). Only the art outside the frame opening counts, so strokes can cross the frame edge; parts that will pop out are outlined in gold and the rest of the art is ghosted so you can see what is available, **Auto** to reset it or **Clear** to remove it. **Breakout room** (shown while pop-out is on) draws the frame smaller inside the token so popped parts can reach past its outer edge; the token is scaled up by the same amount on apply, so the frame still matches the grid. Auto compose sets the room for each layout itself. **Shadow under popped parts** adds a soft drop shadow where parts break out. Shortcuts: Shift-drag pops parts out and Alt-drag or right-drag keeps them inside from any tool, **B** / **V** pick the pop-out brush or move, **[** / **]** or Ctrl+wheel change the brush size, and Ctrl+Z / Ctrl+Shift+Z undo and redo.
- **Pin** tool (**P**, Token mode) animates the art. Click the art to add a pin, drag a pin to move it and right-click to remove it. Pins without keyframes are anchors that hold that part of the art still. In the **Animate** card (after the Frame card), play or pause the loop, scrub the slider, and **Add keyframe** / **Remove keyframe** for the selected pin at the current time; dragging a pin with no keyframes moves it, while dragging a pin that has keyframes changes its motion at the current point in the loop. The **Bob** and **Sway** presets move the selected pin and **Breathe** gently swells the whole figure around the centre of all pins (it moves anchor pins too, so it needs at least two pins); loop length is 1-4 s. Keep moves small, since parts cannot reveal what is behind them. The preview loop keeps playing under Move and Pin, but pauses while a mask or touch-up tool is in use (or a mask stroke is painted), because those edit the still art. When any pin moves, the token is saved as a transparent looping WebM (VP9 with alpha, 30 fps) in the created token folder instead of a still WebP, at up to 512 px (larger output sizes are capped for animated tokens). It works with the painted frame (the pop-out and its shadow move with the art while the frame stays still) and with the dynamic token ring (the video becomes the token image and Foundry uses it as the ring subject; Tokener also starts ring videos Foundry would leave paused). The portrait stays a still image. Animation needs Foundry opened over https or on localhost, because the browser video encoder is not available on plain `http://<ip>`, and a browser that can encode VP9 video; otherwise the Animate card explains why and is disabled.
- Switch to **Portrait** above the preview to edit the actor portrait from the same art: pick a shape (original, 1:1, 2:3, 3:4) and a background (original, transparent cut-out or a colour), then drag and zoom to frame it. **Actor**, **Portrait** and **Both** save that portrait; leave it untouched to keep using the original image.
- To use different art for the token and the portrait, switch to **Portrait** and set **Image** to **Separate image**; anything you load there changes the portrait only. **From portrait** (Token mode) copies the edited portrait in as the token image to frame and experiment with.
- **Save only** writes the file; the apply buttons also update the token or actor like any other Tokener art. Files go to `worlds/<world>/tokener` unless the **Created token folder** setting says otherwise.

## Custom Folders

Use `Configure` beside the `Custom token folders` module setting to add your own world data folders as extra sources.

Each custom folder can have:

- source name
- token folder path
- source-level tags applied to every indexed image from that folder
- optional portrait/artwork folder path
- optional dynamic token subject folder path

Use the folder button to browse Foundry data folders. The custom folder browser shows subfolders and image thumbnails so you can confirm the folder before selecting it.

Tokener scans custom folders recursively. If images live under recognizable `tokens`, `art`, `portraits`, or `subjects` folders, it links token, portrait, and subject images by matching filenames. If no token folder is found, every image in the custom folder can be treated as token art.

Nested custom folder names become searchable `folder:*` tags, excluding structural names such as `tokens`, `art`, `portraits`, `subjects`, `assets`, and `resources`.

You can also type simple paths manually in the setting:

- `tokens/npcs`
- `My NPCs | uploads/npcs`

Separate multiple entries with commas, semicolons, or new lines. Structured custom folder settings remain compatible with older plain path entries.

## Previewing Art

Right-click any result to open fullscreen preview.

The preview shows:

- actor portrait image when available
- token image when available
- source module or custom source name
- associated tags grouped by category

Close preview with the close button, `Escape`, or clicking outside the preview.

## Notes

- Tokener only changes token and actor image references.
- It does not change, copy, import, or generate image files.
- It rebuilds its gallery index on world load and after Tokener tag or custom folder setting changes.
- Result cards use the best available preview source and recover when one image side is missing.
- Utility images such as hazards, treasure, rings, backgrounds, or trackers may not have actor portraits.

## Troubleshooting

### The Tokener Button Does Not Appear

Check that:

- Tokener is enabled
- a token is selected
- your user has permission to update that token
- your Foundry version supports ApplicationV2

### Search Shows No Results

Check that:

- at least one token art module or custom folder source is enabled
- the world was reloaded after enabling token modules
- custom folder paths point inside Foundry data storage
- source, favorites, included tags, or excluded tags are not hiding the art
- the search text is not too specific

Try clearing search, sources, favorites, and tags.

### Actor Image Is Missing In Preview

Some sources only provide token art. Tokener shows portrait panes only when portrait art exists or can be linked by filename.

### Dynamic Token Ring Subject Is Missing

Subject art is only applied when the source provides matching subject art through mappings, datasheets, recognized `subjects` folders, or the custom folder subject path.

### I Enabled A New Token Module But Do Not See It

Reload the Foundry world after enabling or disabling token art modules.

### The Wrong Pack Appears First

Tokener puts exact actor matches and same-name results first when it can identify them. If several packs have similar names or art, use the source filter to narrow results.

## License

See `LICENSE`.
