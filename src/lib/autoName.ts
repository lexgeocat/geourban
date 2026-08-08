export function autoLetterCode(index: number): string {
  let code = '';
  let n = index;
  do {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return code;
}

export function autoName(index: number, prefix: string): string {
  return `${prefix} ${autoLetterCode(index)}`;
}
