import type { Agent, ToolKind } from '@shared/types'

type IconProps = { className?: string }

/** Amber/red speech bubble with "!", used for waiting agents. */
export function BubbleAlert({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 3.5V16H5.5A1.5 1.5 0 0 1 4 14.5v-9Z"
        fill="currentColor"
      />
      <rect x="11" y="7" width="2" height="5" rx="1" fill="#fff" />
      <rect x="11" y="13" width="2" height="2" rx="1" fill="#fff" />
    </svg>
  )
}

export function Pencil({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 7.5 17 10" />
    </svg>
  )
}

export function Terminal({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9l3 3-3 3M12.5 15.5h4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Magnifier({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function Doc({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  )
}

export function Globe({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.5 2.5 13 0 16M12 4c-2.5 2.5-2.5 13 0 16" />
    </svg>
  )
}

export function CheckCircle({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MoonZzz({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.3 6.3 0 0 0 20 14.5Z" />
      <text x="15.5" y="9" fontSize="6" fill="currentColor" fontWeight="700">z</text>
      <text x="18.5" y="6.2" fontSize="4" fill="currentColor" fontWeight="700">z</text>
    </svg>
  )
}

export function Spark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    </svg>
  )
}

export function Gear({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
      <path d="M19.4 13a7.5 7.5 0 0 0 0-2l1.7-1.3-1.7-3-2 .8a7.5 7.5 0 0 0-1.7-1l-.3-2.1H9.6l-.3 2.1a7.5 7.5 0 0 0-1.7 1l-2-.8-1.7 3L5.6 11a7.5 7.5 0 0 0 0 2l-1.7 1.3 1.7 3 2-.8c.5.4 1.1.8 1.7 1l.3 2.1h4.8l.3-2.1c.6-.2 1.2-.6 1.7-1l2 .8 1.7-3L19.4 13Z" />
    </svg>
  )
}

export function ArrowUp({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V6M6 11l6-6 6 6" />
    </svg>
  )
}

function toolIcon(tool: ToolKind | undefined, className: string) {
  switch (tool) {
    case 'bash': return <Terminal className={className} />
    case 'edit': return <Pencil className={className} />
    case 'read': return <Doc className={className} />
    case 'search': return <Magnifier className={className} />
    case 'web': return <Globe className={className} />
    default: return <Spark className={className} />
  }
}

/** Resolves the icon + color class for an agent row from its state. */
export function AgentIcon({ agent }: { agent: Agent }) {
  if (agent.state === 'waiting') {
    const cls = agent.waitReason === 'question' ? 'ic ic--red' : 'ic ic--amber'
    return <span className={cls}><BubbleAlert className="ic-svg" /></span>
  }
  if (agent.state === 'complete') {
    return <span className="ic ic--green"><CheckCircle className="ic-svg" /></span>
  }
  if (agent.state === 'idle') {
    return <span className="ic ic--slate"><MoonZzz className="ic-svg" /></span>
  }
  // running — color by tool
  const tone = agent.tool === 'bash' ? 'ic--blue-solid' : 'ic--blue'
  return <span className={`ic ${tone}`}>{toolIcon(agent.tool, 'ic-svg')}</span>
}
