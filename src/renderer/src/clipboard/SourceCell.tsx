import type { ClipSummary } from '@shared/types'
import { sourceLabel } from '@shared/clips.mjs'

/**
 * The Filter Table's status chip, for a clip's source (beautifului.dev 13):
 * a dot in the kind's colour and the name of what made the copy, then the
 * detail (host, project, size…) muted after it. Shared by the Clipboard pane
 * and the quick picker so a row reads the same in both windows. Colour is a
 * dot and a tint, never a filled row.
 */
const PROVIDER_TONES: Record<string, string> = { claude: '#e8906b', codex: '#6ab0e8', cursor: '#b58cff' }

export function sourceTone(source: ClipSummary['source']): string {
  switch (source.kind) {
    case 'chrome': return 'var(--st-running)'
    case 'terminal': case 'agent': return PROVIDER_TONES[source.provider ?? ''] ?? 'var(--st-idle)'
    case 'manual': return 'var(--accent)'
    default: return 'var(--st-idle)'
  }
}

/**
 * A page URL as the cell prints it: the scheme and a trailing slash dropped,
 * so the host still leads (`github.com/org/repo/pull/12`) and a narrow column
 * ellipsises the path, never the host. Widen the column (its header grip)
 * and the whole URL shows.
 */
export function urlText(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

export function SourceCell({ clip, extras = [], className = 'clip-meta' }: { clip: ClipSummary; extras?: string[]; className?: string }) {
  const [name, ...rest] = sourceLabel(clip.source).split(' · ')
  // With a page URL, the host `sourceLabel` gives is replaced by the URL it starts.
  const url = clip.source.url
  const detail = [...(url ? [urlText(url)] : rest), ...extras].join(' · ')
  const full = [name, url ?? rest.join(' · '), ...extras].filter(Boolean).join(' · ')
  return (
    <span className={className} title={full}>
      <span className={`clip-kind clip-kind--${clip.source.kind}`} style={{ ['--tone' as string]: sourceTone(clip.source) }}>
        <span className="clip-kind-dot" />
        <span className="clip-kind-name">{name || 'Unknown app'}</span>
      </span>
      {detail && <span className="clip-meta-rest">{detail}</span>}
    </span>
  )
}
