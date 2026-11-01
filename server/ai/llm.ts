/**
 * Any OpenAI-compatible chat endpoint. With only `DEEPSEEK_API_KEY` in the environment it talks to DeepSeek;
 * `MYDEFENSE_LLM_URL` / `_MODEL` / `_KEY` point it anywhere else (Ether's gateway, OpenRouter with ZDR).
 * Lifted from eternum-board (`server/llm.ts`), minus streaming and cache: grading is one short call.
 */
/** DeepSeek thinking effort. The API has no `medium`: it maps `medium` to `high`. */
export type Effort = 'low' | 'high' | 'max'

export interface Llm {
  /**
   * One completion. `json` asks the endpoint for a JSON object when it supports it. `effort` sets DeepSeek's thinking
   * effort (default `high`, DeepSeek's own default); other endpoints ignore it.
   */
  complete(
    system: string,
    user: string,
    opts?: { json?: boolean; effort?: Effort },
  ): Promise<string>
}

export const DEEPSEEK_URL = 'https://api.deepseek.com/v1'
export const DEEPSEEK_MODEL = 'deepseek-flash'
const TIMEOUT_MS = 60_000

export class LlmError extends Error {}

export function llmFromEnv(
  env: Record<string, string | undefined>,
  doFetch: typeof fetch = fetch,
): Llm | null {
  const deepseek = !!env.DEEPSEEK_API_KEY
  const key = env.MYDEFENSE_LLM_KEY ?? env.DEEPSEEK_API_KEY
  const base = (
    env.MYDEFENSE_LLM_URL ?? (deepseek ? DEEPSEEK_URL : '')
  ).replace(/\/+$/, '')
  const model = env.MYDEFENSE_LLM_MODEL ?? (deepseek ? DEEPSEEK_MODEL : '')
  if (!base || !model) return null
  const onDeepSeek = base === DEEPSEEK_URL
  return {
    async complete(system, user, opts) {
      let res: Response
      try {
        res = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify({
            model,
            // Thinking mode on DeepSeek takes no temperature; other endpoints keep the low one.
            ...(onDeepSeek
              ? {
                  thinking: { type: 'enabled' },
                  reasoning_effort: opts?.effort ?? 'high',
                }
              : { temperature: 0.1 }),
            ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        throw new LlmError('No se pudo conectar con el modelo.')
      }
      if (!res.ok) throw new LlmError(`El modelo respondió ${res.status}.`)
      const body = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[]
      } | null
      const text = body?.choices?.[0]?.message?.content?.trim()
      if (!text) throw new LlmError('El modelo no devolvió texto.')
      return text
    },
  }
}
