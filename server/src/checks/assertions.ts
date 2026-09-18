/** Minimal JSON path support: $.a.b[0].c — enough for response assertions, no eval. */
export function readJsonPath(value: unknown, path: string): unknown {
  const cleaned = path.replace(/^\$\.?/, '');
  if (!cleaned) return value;
  const segments = cleaned.match(/[^.[\]]+/g) ?? [];
  let current: any = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[/^\d+$/.test(segment) ? Number(segment) : segment];
  }
  return current;
}

export type JsonAssertion = {
  path: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'absent';
  value?: unknown;
};

export function evaluateAssertion(body: unknown, a: JsonAssertion): string | null {
  const actual = readJsonPath(body, a.path);
  const fail = (why: string) => `assertion ${a.path} ${a.operator}: ${why}`;
  switch (a.operator) {
    case 'exists':
      return actual === undefined ? fail('path missing') : null;
    case 'absent':
      return actual === undefined ? null : fail(`expected missing, got ${JSON.stringify(actual)}`);
    case 'eq':
      return JSON.stringify(actual) === JSON.stringify(a.value)
        ? null
        : fail(`expected ${JSON.stringify(a.value)}, got ${JSON.stringify(actual)}`);
    case 'neq':
      return JSON.stringify(actual) !== JSON.stringify(a.value) ? null : fail('values are equal');
    case 'contains':
      if (typeof actual === 'string') {
        return actual.includes(String(a.value)) ? null : fail('substring not found');
      }
      if (Array.isArray(actual)) {
        return actual.some((v) => JSON.stringify(v) === JSON.stringify(a.value))
          ? null
          : fail('item not found');
      }
      return fail('value is not a string or array');
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const left = Number(actual);
      const right = Number(a.value);
      if (Number.isNaN(left) || Number.isNaN(right)) return fail('value is not numeric');
      const ok =
        a.operator === 'gt' ? left > right
        : a.operator === 'lt' ? left < right
        : a.operator === 'gte' ? left >= right
        : left <= right;
      return ok ? null : fail(`${left} is not ${a.operator} ${right}`);
    }
    default:
      return fail('unknown operator');
  }
}

/** Accepts 200, "200", "2xx", "200-299". */
export function statusMatches(status: number, expected: (number | string)[]): boolean {
  return expected.some((rule) => {
    if (typeof rule === 'number') return status === rule;
    const value = String(rule).trim().toLowerCase();
    if (/^\d+$/.test(value)) return status === Number(value);
    if (/^\dxx$/.test(value)) return Math.floor(status / 100) === Number(value[0]);
    const range = value.match(/^(\d{3})\s*-\s*(\d{3})$/);
    if (range) return status >= Number(range[1]) && status <= Number(range[2]);
    return false;
  });
}
