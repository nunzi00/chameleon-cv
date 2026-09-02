/**
 * Iconos de línea de la interfaz (T-8.6): trazos sobre una caja de 24×24, extraídos del prototipo de diseño.
 * Se dibujan con `currentColor`; ninguno se descarga. Los círculos van como trazos de arco para que todo sea <path>.
 */
export type IconName =
  | 'brand'
  | 'folder'
  | 'check-circle'
  | 'play'
  | 'file-down'
  | 'file-up'
  | 'layers'
  | 'copy'
  | 'robot'
  | 'checklist'
  | 'sliders'
  | 'globe'
  | 'book'
  | 'sidebar'
  | 'power'
  | 'shield'
  | 'check'
  | 'alert'
  | 'warning'
  | 'info'
  | 'plus'
  | 'close'
  | 'chevron'
  | 'file';

const CIRCLE_8 = 'M4 12a8 8 0 1016 0a8 8 0 10-16 0';

export const ICONS: Readonly<Record<IconName, readonly string[]>> = {
  brand: ['M4 5h9l3 3h4v11H4z', 'M8 12h6M8 15.5h4'],
  folder: ['M4 6h6l1.5 2H20v11H4z'],
  'check-circle': [CIRCLE_8, 'M8.6 12.2l2.3 2.3 4.4-4.6'],
  play: ['M8 5.5l9 6.5-9 6.5z'],
  'file-down': ['M6 4h8l4 4v12H6z', 'M12 10v6M9.5 13.5L12 16l2.5-2.5'],
  'file-up': ['M6 4h8l4 4v12H6z', 'M12 16v-6M9.5 12.5L12 10l2.5 2.5'],
  layers: ['M12 4l8 4-8 4-8-4z', 'M4 12l8 4 8-4', 'M4 16l8 4 8-4'],
  copy: ['M9 9h9v11H9z', 'M6 15H4V4h11v2'],
  robot: ['M7 8h10a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2z', 'M12 5v3M9 12.5h.01M15 12.5h.01'],
  checklist: ['M4 7.5l2 2 3-3M4 16.5l2 2 3-3M12 8h8M12 17h8'],
  sliders: ['M4 8h10M18 8h2M4 16h4M12 16h8', 'M14 8a2 2 0 104 0a2 2 0 10-4 0', 'M8 16a2 2 0 104 0a2 2 0 10-4 0'],
  globe: [CIRCLE_8, 'M4 12h16M12 4c2.5 2.6 2.5 12.8 0 16-2.5-3.2-2.5-13.4 0-16z'],
  book: ['M5 5h6v14H5zM13 5h6v14h-6z'],
  sidebar: ['M6 5h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z', 'M10 5v14'],
  power: ['M12 4v8M7.5 7a7 7 0 109 0'],
  shield: ['M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  alert: ['M3.5 12a8.5 8.5 0 1017 0a8.5 8.5 0 10-17 0', 'M12 7.5v5M12 16h.01'],
  warning: ['M12 4l8 15H4z', 'M12 10v4M12 16.5h.01'],
  info: ['M3.5 12a8.5 8.5 0 1017 0a8.5 8.5 0 10-17 0', 'M12 11v5.5M12 8h.01'],
  plus: ['M12 6v12M6 12h12'],
  close: ['M6 6l12 12M18 6L6 18'],
  chevron: ['M8 5l7 7-7 7'],
  file: ['M7 4h7l4 4v12H7z', 'M14 4v4h4'],
};
