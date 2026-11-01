/** Dev: migrate + seed, then the API (watch) on :5191 and Vite on :5190 side by side. */
const run = (cmd: string[]) =>
  Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' })

const seed = run(['bun', 'run', 'scripts/seed.ts'])
if ((await seed.exited) !== 0) process.exit(1)

const api = run(['bun', '--watch', 'server/index.ts'])
const web = run(['bunx', '--bun', 'vite'])

const stop = () => {
  api.kill()
  web.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race([api.exited, web.exited])
stop()
