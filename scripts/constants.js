export const MODULE_ID = 'pf2e-tokener';
export const DEFAULT_LIMIT = 120;
export const PLAYER_OWNED_TOKENER_SETTING_KEY = 'allowPlayerOwnedTokens';
export const TOKEN_HUD_BUTTON_SETTING_KEY = 'showTokenHudButton';
export const CUSTOM_FOLDERS_SETTING_KEY = 'customFolders';
export const IMAGE_TAGS_SETTING_KEY = 'imageTags';
export const PICKER_GRID_SIZE_SETTING_KEY = 'pickerGridSize';
export const TOKEN_FOLDER_ROOTS = ['resources/tokens', 'assets/tokens', 'tokens'];
export const PORTRAIT_FOLDER_ROOTS = [
  'resources/art',
  'resources/portraits',
  'assets/art',
  'assets/portraits',
  'art',
  'portraits',
];
export const SUBJECT_FOLDER_ROOTS = ['resources/subjects', 'assets/subjects', 'subjects'];
// Folders that hold tokens/ and portraits/ side by side, possibly a level deeper (the German PF2e
// modules use pictures/tokens and pictures/<book>/tokens).
export const MIXED_ART_FOLDER_ROOTS = ['pictures'];
export const IMAGE_EXTENSIONS = /\.(avif|webp|png|jpe?g|gif)$/i;
export const CREATED_TOKEN_FOLDER_SETTING_KEY = 'createdTokenFolder';
export const TOKEN_CREATOR_DEFAULTS_SETTING_KEY = 'tokenCreatorDefaults';
export const AI_TOOLS_SETTING_KEY = 'enableAiTools';
export const AI_MODEL_SETTING_KEY = 'aiBackgroundModel';
export const AI_CUSTOM_MODEL_SETTING_KEY = 'aiBackgroundCustomModel';
