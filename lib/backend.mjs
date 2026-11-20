import { t } from './i18n.mjs'

export function getBackend(platform = process.platform, env = process.env) {
  const defaults = { darwin: 'launchd', linux: 'systemd', win32: 'windows' }
  const selected = env.CRONLY_BACKEND || defaults[platform] || 'cron'
  if (!['cron', 'launchd', 'systemd', 'windows'].includes(selected)) throw new Error(t('backend.invalid', { backend: selected }))
  return selected
}
