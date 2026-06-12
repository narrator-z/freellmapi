import { NavLink } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'

export function ModelsTabs() {
  const { t } = useI18n()
  const tab = (isActive: boolean) =>
    `px-3 py-1.5 text-xs rounded-lg transition-colors ${
      isActive ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
    }`
  return (
    <div className="inline-flex gap-1 rounded-xl border p-1">
      <NavLink to="/models/chat" className={({ isActive }) => tab(isActive)}>{t('models.chatModels')}</NavLink>
      <NavLink to="/models/embeddings" className={({ isActive }) => tab(isActive)}>{t('models.embeddings')}</NavLink>
    </div>
  )
}
