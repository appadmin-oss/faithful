import type { DesignElement, Screen } from '@faithful/spec';

export function screen(elements: DesignElement[], id = 's'): Screen {
  return { id, name: id, viewport: { width: 1280, height: 800 }, elements };
}
export const text = (
  id: string,
  t: string,
  x: number,
  y: number,
  w = 200,
  h = 24,
  style: DesignElement['style'] = {},
): DesignElement => ({
  id,
  kind: 'text',
  text: t,
  box: { x, y, w, h },
  style: { color: '#10292c', fontSize: 16, fontWeight: 400, fontFamily: 'Inter, sans-serif', lineHeight: 24, ...style },
});
export const box = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: DesignElement['style'] = {},
): DesignElement => ({
  id,
  kind: 'box',
  box: { x, y, w, h },
  style: { background: '#ffffff', radius: 12, ...style },
});
