/** The browser name and version for the report, from the user agent, with no system details. */
export function browserLabel(userAgent: string): string {
  const patterns: [string, RegExp][] = [
    ['Edge', /\bEdg\/(\d+(?:\.\d+)*)/],
    ['Firefox', /\bFirefox\/(\d+(?:\.\d+)*)/],
    ['Chrome', /Chrome\/(\d+(?:\.\d+)*)/],
  ];
  for (const [name, pattern] of patterns) {
    const version = pattern.exec(userAgent)?.[1];
    if (version !== undefined) return `${name} ${version}`;
  }
  return 'unknown browser';
}
