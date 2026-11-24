// Hands Herdr what a status line would, without Claude Code drawing a status line row: the
// plan's rate limits as ~/.cache/herdr-claude/limits.json, and this session's model, effort,
// context use, id and folder as labels on its herdr-core terminal. Loaded in every session
// through CLAUDE_CODE_PLUGIN_DIRS in settings.json.
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

let interactive = false
let context: SessionContextUsage | undefined
let limits: SessionRateLimit[] = []
let effort = ''
let written = ''
let labelled = ''

function named(model: string) {
  const m = model.match(/^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?(?:\[.*\])?$/)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace('-', '.')}` : model
}

async function sync($: EngineInterface) {
  const [home, cache, terminal, model, session, cwd] = await Promise.all([
    $.env.get('HOME'),
    $.env.get('XDG_CACHE_HOME'),
    $.env.get('HC_TERMINAL_ID'),
    $.session.model(),
    $.session.id(),
    $.session.cwd(),
  ])

  if (limits.length > 0) {
    const text = JSON.stringify(
      Object.fromEntries(
        limits.map(l => [
          l.kind,
          { used_percentage: l.percentUsed, ...(l.resetsAt ? { resets_at: Math.round(Date.parse(l.resetsAt) / 1000) } : {}) },
        ]),
      ),
    )
    if (text !== written) {
      await $.fs.write(`${cache || `${home}/.cache`}/herdr-claude/limits.json`, text)
      written = text
    }
  }

  if (!terminal) return
  const labels = [
    `claude.context=${context?.percent ?? ''}`,
    `claude.context_size=${context?.window ?? ''}`,
    `claude.session=${session}`,
    `claude.model=${named(model)}`,
    `claude.effort=${effort}`,
    `claude.cwd=${cwd}`,
  ]
  const text = labels.join('\n')
  if (text === labelled) return
  const { exitCode } = await $.process.run([`${home}/.local/bin/hc`, 'label', terminal, ...labels])
  if (exitCode === 0) labelled = text
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    interactive = e.isInteractive
    if (interactive) {
      const usage = await $.session.usage()
      context = usage.context
      limits = usage.rateLimits
      await sync($)
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (interactive) {
      context = e.context
      limits = e.rateLimits
      await sync($)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const level = e.effort === undefined ? '' : String(e.effort)
    if (interactive && e.agentId === undefined && level !== effort) {
      effort = level
      $.clock.after(0, () => sync($))
    }
    return yield* next(e)
  })
}
