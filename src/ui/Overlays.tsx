import { useState, type CSSProperties, type ReactNode } from 'react'
import type { GameDuration, GameSettings, GameSnapshot, RulesetId, RunResult } from '../types'

const numberFormat = new Intl.NumberFormat('zh-CN')
const percentFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 })

function formatScore(score: number) {
  return numberFormat.format(score)
}

function formatAccuracy(hits: number, shots: number) {
  return `${percentFormat.format(shots ? (hits / shots) * 100 : 0)}%`
}

function formatTtk(value: number | null) {
  return value === null ? '—' : `${Math.round(value)} ms`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '未知时间'
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

function OverlayHeading({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <header className="panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <button className="icon-button" type="button" onClick={onClose} aria-label="关闭面板" autoFocus>
        <span aria-hidden="true">×</span>
      </button>
    </header>
  )
}

function ActionButton({ children, onClick, secondary = false, className = '' }: {
  children: ReactNode
  onClick: () => void
  secondary?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`action-button ${secondary ? 'action-button--secondary' : ''} ${className}`.trim()}
      onClick={onClick}
    >
      {children}
      <span aria-hidden="true" className="action-button__arrow">↗</span>
    </button>
  )
}

export interface MenuOverlayProps {
  settings: GameSettings
  onChange: (settings: GameSettings) => void
  onStart: () => void
  onLeaderboard: () => void
  error?: string | null
  storageWarning?: string | null
}

export function MenuOverlay({ settings, onChange, onStart, onLeaderboard, error, storageWarning }: MenuOverlayProps) {
  return (
    <div className="aim-overlay aim-overlay--menu">
      <div className="menu-frame">
        <header className="menu-topbar">
          <div className="brand-mark" aria-label="DSBYTE AIM">
            <span className="brand-mark__glyph" aria-hidden="true" />
            <span>DSBYTE<span className="brand-mark__slash">/</span>AIM</span>
          </div>
          <button className="menu-records" type="button" onClick={onLeaderboard}>成绩记录 <span aria-hidden="true">↗</span></button>
        </header>

        <div className="menu-settings"><SettingsControls settings={settings} onChange={onChange} /></div>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {storageWarning && <p className="notice notice--warning" role="status">{storageWarning}</p>}
        <div className="menu-launch"><button className="menu-start" type="button" onClick={onStart} aria-label="开始训练 START">START</button></div>
      </div>
    </div>
  )
}

interface SettingsControlsProps {
  settings: GameSettings
  onChange: (settings: GameSettings) => void
}

function SettingsControls({ settings, onChange }: SettingsControlsProps) {
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => onChange({ ...settings, [key]: value })
  const updateNumber = (key: 'crosshairSize' | 'targetScale', value: string, min: number, max: number) => {
    if (value.trim() === '') return
    const parsed = Number(value)
    if (Number.isFinite(parsed)) update(key, Math.min(max, Math.max(min, parsed)))
  }
  const updateTypedNumber = (key: 'sensitivity', value: string, min: number, max: number) => {
    const parsed = Number(value)
    if (value.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max) update(key, parsed)
  }
  const commitTypedNumber = (key: 'sensitivity', input: HTMLInputElement, min: number, max: number) => {
    const parsed = Number(input.value)
    if (!input.value.trim() || !Number.isFinite(parsed)) {
      input.value = String(settings[key])
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    input.value = String(clamped)
    update(key, clamped)
  }

  return (
        <div className="settings-controls">
          <section className="setting-section" aria-labelledby="settings-control">
            <div className="setting-section__heading"><h3 id="settings-control">鼠标</h3></div>
              <label className="setting-field">鼠标灵敏度
                <input type="number" min="0.001" max="30" step="any" inputMode="decimal" defaultValue={settings.sensitivity} onChange={(event) => updateTypedNumber('sensitivity', event.target.value, 0.001, 30)} onBlur={(event) => commitTypedNumber('sensitivity', event.currentTarget, 0.001, 30)} />
              </label>
          </section>

          <section className="setting-section" aria-labelledby="settings-visual">
            <div className="setting-section__heading"><h3 id="settings-visual">准星</h3></div>
            <div className="setting-field">
              <label>准星样式</label>
              <div className="crosshair-options" role="group" aria-label="准星样式">
                {(['cross', 'dot', 'ring'] as const).map((style) => (
                  <button key={style} type="button" className={settings.crosshairStyle === style ? 'is-active' : ''} aria-pressed={settings.crosshairStyle === style} onClick={() => update('crosshairStyle', style)}>
                    <span aria-hidden="true" className={`crosshair-choice crosshair-choice--${style}`} />
                    <span>{style === 'cross' ? '十字' : style === 'dot' ? '圆点' : '圆环'}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="setting-field setting-field--range">准星大小 <strong>{settings.crosshairSize} px</strong>
              <input type="range" min="2" max="30" step="1" value={settings.crosshairSize} onChange={(event) => updateNumber('crosshairSize', event.target.value, 2, 30)} />
            </label>
              <label className="setting-field color-field">准星颜色
                <span className="color-input-wrap"><input type="color" aria-label="准星颜色" value={settings.crosshairColor} onChange={(event) => update('crosshairColor', event.target.value)} /><span>{settings.crosshairColor.toUpperCase()}</span></span>
              </label>
            <div className="crosshair-preview" aria-label="准星预览"><span>准星预览</span><Crosshair settings={settings} /></div>
          </section>

          <section className="setting-section" aria-labelledby="settings-session">
            <div className="setting-section__heading"><h3 id="settings-session">训练</h3></div>
            <div className="setting-field"><label id="duration-label">训练时长</label>
            <div className="segmented-control segmented-control--duration" role="group" aria-labelledby="duration-label">
              {([30, 60] as GameDuration[]).map((duration) => (
                <button key={duration} type="button" className={settings.durationSec === duration ? 'is-active' : ''} aria-pressed={settings.durationSec === duration} onClick={() => update('durationSec', duration)}>{duration} 秒</button>
              ))}
            </div>
            </div>
            <label className="setting-field setting-field--range">靶子大小 <strong>{settings.targetScale.toFixed(1)}×</strong>
              <input type="range" min="0.4" max="1.5" step="0.1" value={settings.targetScale} onChange={(event) => updateNumber('targetScale', event.target.value, 0.4, 1.5)} />
            </label>
            {Math.abs(settings.targetScale - 1) > 0.001 && <p className="setting-help setting-help--alert">练习配置，不计入排行榜。</p>}
            <label className="setting-field color-field">靶子颜色
              <span className="color-input-wrap"><input type="color" aria-label="靶子颜色" value={settings.targetColor} onChange={(event) => update('targetColor', event.target.value)} /><span>{settings.targetColor.toUpperCase()}</span></span>
            </label>
            <label className="sound-toggle">
              <span><strong>音效</strong></span>
              <input type="checkbox" aria-label="射击与命中音效" checked={settings.soundEnabled} onChange={(event) => update('soundEnabled', event.target.checked)} />
              <span className="sound-toggle__switch" aria-hidden="true" />
            </label>
          </section>
        </div>
  )
}

export interface LeaderboardOverlayProps {
  duration: GameDuration
  rulesetId: RulesetId
  onRulesetChange: (rulesetId: RulesetId) => void
  hasLegacyRecords: boolean
  runs: RunResult[]
  recentRuns: RunResult[]
  onDurationChange: (duration: GameDuration) => void
  onClose: () => void
  storageWarning?: string | null
}

export function LeaderboardOverlay({ duration, rulesetId, onRulesetChange, hasLegacyRecords, runs, recentRuns, onDurationChange, onClose, storageWarning }: LeaderboardOverlayProps) {
  const [view, setView] = useState<'ranking' | 'recent'>('ranking')
  const ranked = runs
    .filter((run) => run.ranked && run.durationSec === duration && run.rulesetId === rulesetId)
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.playedAt.localeCompare(b.playedAt))
    .slice(0, 10)
  const recent = [...recentRuns].sort((a, b) => b.playedAt.localeCompare(a.playedAt)).slice(0, 50)

  return (
    <div className="aim-overlay aim-overlay--panel" role="presentation">
      <div className="panel-backdrop" onClick={onClose} />
      <section className="side-panel leaderboard-panel" role="dialog" aria-modal="true" aria-label="本地排行榜" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      }}>
        <OverlayHeading eyebrow="LOCAL RECORDS / GRIDSHOT" title="本地记录" onClose={onClose} />
        {storageWarning && <p className="notice notice--warning record-storage-warning" role="status">保存提示：{storageWarning}</p>}
        <div className="record-view-tabs" role="group" aria-label="记录视图">
          <button type="button" className={view === 'ranking' ? 'is-active' : ''} aria-pressed={view === 'ranking'} onClick={() => setView('ranking')}>排行榜</button>
          <button type="button" className={view === 'recent' ? 'is-active' : ''} aria-pressed={view === 'recent'} onClick={() => setView('recent')}>最近训练 <span>{recent.length}</span></button>
        </div>
        <div className="leaderboard-intro">{view === 'ranking' ? '仅显示默认靶子大小的标准成绩，30 秒和 60 秒分别排名。' : '最近 50 局训练，包含各版本的标准成绩与练习记录。'}</div>
        {view === 'ranking' && hasLegacyRecords && <div className="segmented-control leaderboard-rulesets" role="group" aria-label="排行榜版本">
          <button type="button" className={rulesetId === 'free-v2' ? 'is-active' : ''} aria-pressed={rulesetId === 'free-v2'} onClick={() => onRulesetChange('free-v2')}>随机靶场</button>
          <button type="button" className={rulesetId === 'grid-v1' ? 'is-active' : ''} aria-pressed={rulesetId === 'grid-v1'} onClick={() => onRulesetChange('grid-v1')}>旧版九宫格</button>
        </div>}
        {view === 'ranking' && <div className="segmented-control leaderboard-tabs" role="group" aria-label="排行榜训练时长">
          {([30, 60] as GameDuration[]).map((value) => <button key={value} type="button" className={duration === value ? 'is-active' : ''} aria-pressed={duration === value} onClick={() => onDurationChange(value)}>{value} 秒</button>)}
        </div>}
        {view === 'ranking' && ranked.length ? (
          <ol className="rank-list">
            {ranked.map((run, index) => <li key={run.id} className={index === 0 ? 'rank-list__first' : ''}>
              <span className="rank-position">{String(index + 1).padStart(2, '0')}</span>
              <div className="rank-main"><strong>{formatScore(run.score)}</strong><small>{formatDate(run.playedAt)}</small></div>
              <div className="rank-extra"><span>{formatAccuracy(run.hits, run.shots)}</span><small>{run.hits} 命中</small></div>
            </li>)}
          </ol>
        ) : view === 'ranking' ? <div className="empty-state"><span aria-hidden="true">◎</span><strong>暂无 {duration} 秒成绩</strong><p>{rulesetId === 'grid-v1' ? '此时长尚无旧版九宫格成绩。' : '完成一局标准 Gridshot，第一条记录就会出现在这里。'}</p></div> : recent.length ? (
          <ol className="recent-list">
            {recent.map((run) => <li key={run.id}>
              <div className="recent-list__top"><strong>{formatScore(run.score)}</strong><div className="record-tags"><span className={`record-type ${run.rulesetId === 'grid-v1' ? 'record-type--legacy' : ''}`}>{run.rulesetId === 'grid-v1' ? '旧版九宫格' : '随机靶场'}</span><span className={`record-type ${run.ranked ? 'record-type--ranked' : ''}`}>{run.ranked ? '标准' : '练习'}</span></div></div>
              <div className="recent-list__bottom"><span>{run.durationSec} 秒 <b aria-hidden="true">/</b> {formatAccuracy(run.hits, run.shots)}</span><time dateTime={run.playedAt}>{formatDate(run.playedAt)}</time></div>
            </li>)}
          </ol>
        ) : <div className="empty-state"><span aria-hidden="true">◎</span><strong>尚无训练记录</strong><p>完成一局后，标准成绩与练习记录都会出现在这里。</p></div>}
        <footer className="panel-footer"><ActionButton onClick={onClose} secondary>返回靶场</ActionButton></footer>
      </section>
    </div>
  )
}

export interface PauseOverlayProps {
  onResume: () => void
  onRestart: () => void
  onQuit: () => void
  error?: string | null
}

export function PauseOverlay({ onResume, onRestart, onQuit, error }: PauseOverlayProps) {
  return (
    <div className="aim-overlay aim-overlay--center aim-overlay--pause">
      <section className="modal-panel pause-panel" role="dialog" aria-modal="true" aria-label="训练暂停">
        <span className="eyebrow">SESSION INTERRUPTED</span>
        <h2>训练暂停<span className="pause-icon" aria-hidden="true">Ⅱ</span></h2>
        <p>计时与击中耗时已暂停。继续时会重新锁定鼠标，并在倒数后恢复。</p>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <div className="pause-actions">
          <ActionButton onClick={onResume}>继续训练</ActionButton>
          <button type="button" onClick={onRestart}>重新开始 <span aria-hidden="true">↗</span></button>
          <button type="button" onClick={onQuit}>退出至菜单 <span aria-hidden="true">↗</span></button>
        </div>
        <span className="modal-footnote">ESC / 失焦将暂停训练</span>
      </section>
    </div>
  )
}

export interface ResultOverlayProps {
  result: RunResult
  isBest: boolean
  onAgain: () => void
  onMenu: () => void
  onLeaderboard: () => void
  error?: string | null
  storageWarning?: string | null
}

export function ResultOverlay({ result, isBest, onAgain, onMenu, onLeaderboard, error, storageWarning }: ResultOverlayProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <div className="aim-overlay aim-overlay--center aim-overlay--result">
      <section className="modal-panel result-panel" role="dialog" aria-modal="true" aria-label="训练结果">
        <div className="result-heading"><span className="eyebrow">SESSION COMPLETE / {result.durationSec} SEC</span><span className={`result-rank-tag ${result.ranked ? '' : 'result-rank-tag--practice'}`}>{result.ranked ? '标准成绩' : '练习记录'}</span></div>
        <h2>本局完成<span aria-hidden="true">.</span></h2>
        {isBest && <div className="personal-best"><span aria-hidden="true">✦</span> NEW PERSONAL BEST</div>}
        {storageWarning && <p className="notice notice--warning result-storage-warning" role="status">保存提示：{storageWarning}</p>}
        <div className="result-score"><span>总得分</span><strong>{formatScore(result.score)}</strong><small>GRIDSHOT / {result.durationSec} 秒 · 每球 1 分</small></div>
        <div className="result-core-grid">
          <div><span>命中率</span><strong>{formatAccuracy(result.hits, result.shots)}</strong></div>
          <div><span>命中数</span><strong>{result.hits}</strong></div>
          <div><span>最长连击</span><strong>{result.bestStreak}</strong></div>
          <div><span>平均 TTK</span><strong>{formatTtk(result.avgTtkMs)}</strong></div>
        </div>
        <button className="details-toggle" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>详细数据 <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span></button>
        {detailsOpen && <div className="result-details">
          <div><span>总射击</span><strong>{result.shots}</strong></div>
          <div><span>射偏</span><strong>{result.misses}</strong></div>
          <div><span>最佳 TTK</span><strong>{formatTtk(result.bestTtkMs)}</strong></div>
          <div><span>射击频率</span><strong>{result.shotsPerSecond.toFixed(2)} 次/秒</strong></div>
          <div><span>靶子大小</span><strong>{result.targetScale.toFixed(1)}×</strong></div>
        </div>}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <div className="result-actions"><ActionButton onClick={onAgain}>再来一局</ActionButton><button type="button" onClick={onLeaderboard}>查看排行榜</button><button type="button" onClick={onMenu}>返回菜单</button></div>
      </section>
    </div>
  )
}

export interface HudProps { snapshot: GameSnapshot }

export function Hud({ snapshot }: HudProps) {
  const remaining = Math.max(0, snapshot.remainingMs / 1000)
  return (
    <div className="game-hud" aria-label="训练数据">
      <div className="hud-top">
        <div className="hud-score" role="group" aria-label="得分"><strong>{formatScore(snapshot.score)}</strong></div>
        <div className={`hud-session${remaining <= 10 ? ' hud-session--urgent' : ''}`} role="group" aria-label="剩余时间">
          <strong>{remaining.toFixed(1)}</strong>
        </div>
        <div className="hud-accuracy" role="group" aria-label="命中率"><strong>{formatAccuracy(snapshot.hits, snapshot.shots)}</strong></div>
      </div>
    </div>
  )
}

export interface CrosshairProps { settings: GameSettings }

export function Crosshair({ settings }: CrosshairProps) {
  const style = { '--crosshair-size': `${settings.crosshairSize}px`, '--crosshair-color': settings.crosshairColor } as CSSProperties
  return <div className={`game-crosshair game-crosshair--${settings.crosshairStyle}`} style={style} aria-hidden="true" />
}

export interface CountdownProps { value: number }

export function Countdown({ value }: CountdownProps) {
  return <div className="countdown-overlay" role="status" aria-live="assertive"><span>准备射击</span><strong key={value}>{value}</strong><small>准星锁定中心</small></div>
}

export interface UnsupportedScreenProps { reason: string }

export function UnsupportedScreen({ reason }: UnsupportedScreenProps) {
  return <main className="unsupported-screen" role="alert"><div className="brand-mark"><span className="brand-mark__glyph" aria-hidden="true" /><span>DSBYTE<span className="brand-mark__slash">/</span>AIM</span></div><div className="unsupported-screen__body"><span className="eyebrow">DEVICE CHECK / UNAVAILABLE</span><h1>当前设备<br />无法开始训练。</h1><p>{reason}</p><small>建议使用支持 WebGL 2 与 Pointer Lock 的桌面浏览器，连接键盘和鼠标后重试。</small></div></main>
}
