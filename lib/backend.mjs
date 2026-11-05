import { t } from './i18n.mjs'

export function getBackend(platform = process.platform, env = process.env) {
  const selected = env.CRONLY_BACKEND || (platform === 'darwin' ? 'launchd' : 'cron')
  if (!['cron', 'launchd'].includes(selected)) throw new Error(t('backend.invalid', { backend: selected }))
  return selected
}
