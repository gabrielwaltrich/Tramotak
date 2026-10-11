export type MathPart = { kind: 'text'; value: string } | { kind: 'math'; value: string; display: boolean }

/** Separa "$$bloco$$" e "$inline$" do texto. "\$" vira cifrão literal. */
export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = []
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$((?:\\\$|[^$\n])+?)\$/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) })
    parts.push({ kind: 'math', value: (m[1] ?? m[2]).trim(), display: m[1] !== undefined })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return parts.map((p) => (p.kind === 'text' ? { ...p, value: p.value.replace(/\\\$/g, '$') } : p))
}
