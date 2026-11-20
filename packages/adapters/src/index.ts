import type { Adapter } from '@faithful/core';
import { canvasAdapter } from './canvas.js';
import { dcHtmlAdapter } from './dc-html.js';
import { designSystemAdapter } from './design-system.js';
import { copyDeckAdapter, designMdAdapter, figmaAdapter, imageAdapter, specAdapter, tokensAdapter } from './formats.js';
import { htmlAdapter } from './html.js';

export { CANVAS_FORMAT, type CanvasBoard, canvasAdapter, canvasBoards } from './canvas.js';
export { dcHtmlAdapter, findSiteRoot, HOLE, missingScripts, scrubHoles } from './dc-html.js';
export { dcRuntime } from './dc-runtime.js';
export { DESIGN_SYSTEM_FORMAT, designSystemAdapter, designSystemTokens } from './design-system.js';
export {
  copyDeckAdapter,
  designMdAdapter,
  figmaAdapter,
  figmaScreens,
  imageAdapter,
  inventoryFromTokens,
  specAdapter,
  tokensAdapter,
  tokensFromCss,
  tokensFromDtcg,
} from './formats.js';
export { htmlAdapter } from './html.js';

/** Every built-in reader. Order does not matter: the most confident sniff wins. */
export const ADAPTERS: Adapter[] = [
  specAdapter,
  dcHtmlAdapter,
  canvasAdapter,
  figmaAdapter,
  tokensAdapter,
  designSystemAdapter,
  designMdAdapter,
  copyDeckAdapter,
  imageAdapter,
  htmlAdapter,
];
