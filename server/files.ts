import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import type { FileStore } from './db/workspace.ts'

/** Uploaded bytes under one directory. Paths come from ULIDs we generate, but never trust that: stay inside `root`. */
export function diskFiles(root: string): FileStore {
  const resolve = (path: string) => {
    const full = normalize(join(root, path))
    if (!full.startsWith(normalize(root) + sep))
      throw new Error('path escapes the files directory')
    return full
  }
  return {
    async write(path, bytes) {
      const full = resolve(path)
      await mkdir(dirname(full), { recursive: true })
      await Bun.write(full, bytes)
    },
    async remove(path) {
      await rm(resolve(path), { force: true })
    },
  }
}
