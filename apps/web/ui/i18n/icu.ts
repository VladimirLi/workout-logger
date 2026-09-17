/**
 * A deliberately small ICU MessageFormat subset (i18n.scope.english-ready).
 *
 * Supports `{name}` arguments and `{name, plural, =n {...} one {...} other {...}}` with `#`
 * for the formatted number, plural categories chosen by Intl.PluralRules (CLDR). Nothing
 * else: no select, no nested formats. A catalogue string that uses more fails loudly, so a
 * translation can never silently drop a clause. No MessageFormat dependency is added.
 */
type Values = Readonly<Record<string, string | number>>;

function readBlock(pattern: string, start: number): { body: string; end: number } {
  let depth = 0;
  for (let index = start; index < pattern.length; index += 1) {
    if (pattern[index] === '{') depth += 1;
    if (pattern[index] === '}') {
      depth -= 1;
      if (depth === 0) return { body: pattern.slice(start + 1, index), end: index + 1 };
    }
  }
  throw new Error(`unbalanced braces in message: ${pattern}`);
}

function plural(body: string, count: number, locale: string): string {
  const branches = new Map<string, string>();
  let index = 0;
  while (index < body.length) {
    const selector = /^\s*(=\d+|zero|one|two|few|many|other)\s*/.exec(body.slice(index));
    if (!selector?.[1]) break;
    index += selector[0].length;
    const block = readBlock(body, index);
    branches.set(selector[1], block.body);
    index = block.end;
  }
  if (body.slice(index).trim() !== '' || !branches.has('other')) {
    throw new Error(`unsupported plural clause: ${body}`);
  }
  const chosen =
    branches.get(`=${count}`) ??
    branches.get(new Intl.PluralRules(locale).select(count)) ??
    branches.get('other') ??
    '';
  return chosen.replaceAll('#', new Intl.NumberFormat(locale).format(count));
}

export function formatMessage(pattern: string, values: Values = {}, locale = 'en-GB'): string {
  let output = '';
  let index = 0;
  while (index < pattern.length) {
    if (pattern[index] !== '{') {
      output += pattern[index];
      index += 1;
      continue;
    }
    const { body, end } = readBlock(pattern, index);
    const [name = '', type, ...rest] = body.split(',');
    const key = name.trim();
    if (!(key in values)) throw new Error(`missing value "${key}" for message: ${pattern}`);
    const value = values[key];
    if (type === undefined) {
      output += typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
    } else if (type.trim() === 'plural' && typeof value === 'number') {
      output += formatMessage(plural(rest.join(','), value, locale), values, locale);
    } else {
      throw new Error(`unsupported argument type "${type.trim()}" in message: ${pattern}`);
    }
    index = end;
  }
  return output;
}
