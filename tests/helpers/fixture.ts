import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cria uma pasta temporária com os arquivos listados (caminhos com `/`). */
export async function makeCourse(files: string[]): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'tramotak-'))
  for (const rel of files) {
    const abs = join(root, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, 'x')
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}
