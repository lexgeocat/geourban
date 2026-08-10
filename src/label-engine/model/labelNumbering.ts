import { autoLetterCode } from '@kernel/id/autoName';

export type LabelNumberingMode =
  | 'numeric'
  | 'numeric-padded'
  | 'alpha-upper'
  | 'alpha-lower'
  | 'roman-upper'
  | 'roman-lower'
  | 'circled'
  | 'circled-alpha'
  | 'parent-dash'
  | 'parent-compact';

export interface NumberingModeInfo {
  key: LabelNumberingMode;
  label: string;
  example: string;
  needsParent?: boolean;
}

export const LABEL_NUMBERING_MODES: NumberingModeInfo[] = [
  { key: 'numeric', label: 'Numérico', example: '1, 2, 3…' },
  { key: 'numeric-padded', label: 'Numérico con ceros', example: '01, 02, 03…' },
  { key: 'alpha-upper', label: 'Alfabético (mayúsculas)', example: 'A, B, C…' },
  { key: 'alpha-lower', label: 'Alfabético (minúsculas)', example: 'a, b, c…' },
  { key: 'roman-upper', label: 'Romano (mayúsculas)', example: 'I, II, III…' },
  { key: 'roman-lower', label: 'Romano (minúsculas)', example: 'i, ii, iii…' },
  { key: 'circled', label: 'Numérico en insignia', example: '① ② ③ (dibujado, no glifo)' },
  { key: 'circled-alpha', label: 'Alfabético en insignia', example: 'Ⓐ Ⓑ Ⓒ (dibujado, no glifo)' },
  {
    key: 'parent-dash',
    label: 'Código padre + guion',
    example: 'A-1, A-2… (según manzano)',
    needsParent: true,
  },
  {
    key: 'parent-compact',
    label: 'Código padre compacto',
    example: 'A1, A2… (según manzano)',
    needsParent: true,
  },
];

const ROMAN_TABLE: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Numerales romanos clásicos. Más allá de 3999 (fuera del sistema clásico) cae a numérico. */
export function toRomanNumeral(value: number): string {
  let n = Math.max(1, Math.floor(value));
  if (n > 3999) return String(value);
  let out = '';
  for (const [v, sym] of ROMAN_TABLE) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

const CIRCLED_1_20 = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
  '⑯',
  '⑰',
  '⑱',
  '⑲',
  '⑳',
];
const CIRCLED_21_35 = [
  '㉑',
  '㉒',
  '㉓',
  '㉔',
  '㉕',
  '㉖',
  '㉗',
  '㉘',
  '㉙',
  '㉚',
  '㉛',
  '㉜',
  '㉝',
  '㉞',
  '㉟',
];
const CIRCLED_36_50 = [
  '㊱',
  '㊲',
  '㊳',
  '㊴',
  '㊵',
  '㊶',
  '㊷',
  '㊸',
  '㊹',
  '㊺',
  '㊻',
  '㊼',
  '㊽',
  '㊾',
  '㊿',
];

export function toCircledNumber(n: number): string {
  if (n >= 1 && n <= 20) return CIRCLED_1_20[n - 1];
  if (n >= 21 && n <= 35) return CIRCLED_21_35[n - 21];
  if (n >= 36 && n <= 50) return CIRCLED_36_50[n - 36];
  return `(${n})`;
}
export function toCircledAlpha(index0: number): string {
  if (index0 >= 0 && index0 < 26) return String.fromCodePoint(0x24b6 + index0);
  return `(${autoLetterCode(index0)})`;
}
export function formatOrderLabel(
  mode: LabelNumberingMode,
  index0: number,
  total: number,
  parentCode?: string
): string {
  switch (mode) {
    case 'numeric':
      return String(index0 + 1);
    case 'numeric-padded': {
      const width = Math.max(2, String(Math.max(1, total)).length);
      return String(index0 + 1).padStart(width, '0');
    }
    case 'alpha-upper':
      return autoLetterCode(index0);
    case 'alpha-lower':
      return autoLetterCode(index0).toLowerCase();
    case 'roman-upper':
      return toRomanNumeral(index0 + 1);
    case 'roman-lower':
      return toRomanNumeral(index0 + 1).toLowerCase();
    case 'circled':
      return String(index0 + 1);
    case 'circled-alpha':
      return autoLetterCode(index0);
    case 'parent-dash':
      return parentCode ? `${parentCode}-${index0 + 1}` : autoLetterCode(index0);
    case 'parent-compact':
      return parentCode ? `${parentCode}${index0 + 1}` : autoLetterCode(index0);
    default:
      return String(index0 + 1);
  }
}
