// Hands Herdr what a status line would, without Claude Code drawing a status line row: the
// plan's rate limits as ~/.cache/herdr-claude/limits.json, and this session's model, effort,
// context use, id and folder as labels on its herdr-core terminal. It also keeps the session's
// title saying what the session is about (title.ts), until the person renames it themselves,
// and shows the model and effort among the footer's mode labels, beside the permission mode.
// Loaded in every session through CLAUDE_CODE_PLUGIN_DIRS in settings.json.
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import { renamed, retitle } from './title'

let interactive = false
let context: SessionContextUsage | undefined
let limits: SessionRateLimit[] = []
let effort = ''
let written = ''
let labelled = ''
let footer = ''

function named(model: string) {
  const m = model.match(/^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?(?:\[.*\])?$/)
  if (!m?.[1] || !m[2]) return model
  return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2].replace('-', '.')}`
}

// The effort saved as the model's default, until a request says what this session uses.
async function saved($: EngineInterface) {
  const [settings, model] = await Promise.all([$.settings.read(), $.session.model()])
  const s = settings as { effortLevel?: string; modelSettings?: Record<string, { effortLevel?: string }> }
  return s.modelSettings?.[model.replace(/\[.*\]$/, '')]?.effortLevel ?? s.effortLevel ?? ''
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

  const label = [named(model), effort].filter(Boolean).join(' · ')
  if (label !== footer) {
    footer = label
    $.ui.invalidate('ui.render')
  }

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
      effort = await saved($)
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

  // /effort with a typed level shows at once. Its slider and /model's picker answer before a pick
  // is made, and a session-only pick is in no setting: those show with the next request (turn.step).
  on('command.run', async ($, e, next) => {
    const ran = await next(e)
    if (!interactive) return ran
    if (e.command === 'rename') {
      if (e.origin.kind === 'plugin' && e.origin.name === $.plugin.name) return { ...ran, text: undefined }
      await renamed($)
    }
    const level = e.command === 'effort' ? e.args.trim().toLowerCase() : ''
    if (['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(level)) {
      effort = level === 'auto' ? '' : level
      await sync($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, ($, e, next) =>
    interactive && footer ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, footer] } }) : next(e),
  )

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (interactive && e.agentId === undefined && e.reason === 'answer') $.clock.after(0, () => retitle($))
    return done
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
