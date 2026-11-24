import type { EngineInterface } from 'claude-code'

type Titled = { title?: string; turn?: number; manual?: boolean }

const SYSTEM = `You name coding sessions for a sidebar. Reply with only the title: 3 to 7 words, sentence case, no quotes, no trailing period.
Name the specific problem, feature or subject being worked on, the way a teammate would describe it, for example "Matomo CloudFront double tracking" or "SSH signing failures on push".
Never just echo a command, skill name, URL, branch or PR number: when the session reviews a pull request, name what the pull request changes.
When a current title is given and still fits the latest work, reply with it unchanged.`

let busy = false

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text)

// Titled after the first prompt, then on prompts 3, 5, 10, 15… while the person hasn't renamed it.
const due = (turns: number, last?: number) => (last === undefined ? turns >= 1 : turns !== last && (turns === 3 || turns % 5 === 0))

export async function retitle($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    const key = `title:${await $.session.id()}`
    const was = ((await $.store.get(key)) ?? {}) as Titled
    const turns = await $.session.turns()
    if (was.manual || !due(turns, was.turn)) return
    const all = await $.session.messages()
    if (!Array.isArray(all)) return
    const said = all.filter(m => m.text.trim())
    const first = said.find(m => m.role === 'user')
    const prompt = [
      was.title ? `Current title: ${was.title}` : '',
      first ? `First message:\n${clip(first.text, 800)}` : '',
      `Latest messages:\n${said.slice(-10).map(m => `${m.role}: ${clip(m.text, 400)}`).join('\n\n')}`,
    ].filter(Boolean).join('\n\n')
    const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt, maxTokens: 40 })
    if (!r.isAnswered) return
    const title = (r.text.trim().split('\n')[0] ?? '').trim().replace(/^["'`]+|["'`.]+$/g, '').slice(0, 80)
    if (!title) return
    if (title !== was.title) await $.command.run({ command: 'rename', args: title })
    await $.store.set(key, { title, turn: turns })
  } finally {
    busy = false
  }
}

export async function renamed($: EngineInterface) {
  const key = `title:${await $.session.id()}`
  await $.store.set(key, { ...(((await $.store.get(key)) ?? {}) as Titled), manual: true })
}
