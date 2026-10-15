import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { FolderPlus, Pencil, Trash2 } from 'lucide-react'
import { groupProblem, MAX_GROUP_DESCRIPTION, MAX_GROUP_NAME } from '@shared/clips.mjs'
import type { ClipGroupInfo, ClipGroupOp } from '@shared/types'
import { tid } from '../testid'

/** What the caller wants opened on arrival (or later: `n` moves for each new ask, so the same request can repeat). */
export interface GroupRequest {
  kind: 'new' | 'edit'
  name?: string
  n: number
}

/**
 * The groups, managed: one row per group — dot, name, description, how many
 * clips carry it — with Edit and Delete on hover, a New group button, and
 * inline forms for name + description (never a dialog; the picker is a
 * popup). Shared by the picker's Settings → Groups page and the pane's
 * More → Manage groups… card: every change is one `clips:group` call, and
 * what shows is whatever `clips:changed` brings back — nothing is held here.
 * The description is the hover text of the group's chip in both windows.
 */
export function GroupManager({ groups, groupInfo, count, dot, manage, request, onPick, onIdle, testPrefix }: {
  groups: string[]
  groupInfo: Record<string, ClipGroupInfo>
  /** How many clips carry the group. */
  count: (name: string) => number
  /** The group's dot colour (each window derives it the same way). */
  dot: (name: string) => string
  manage: (op: ClipGroupOp) => Promise<boolean | string>
  /** Open the new-group form, or a group's edit form, when this changes. */
  request?: GroupRequest | null
  /** A click on a group's name: filter the list to it. */
  onPick?: (name: string) => void
  /** A form closed (saved or cancelled): the caller may want focus back. */
  onIdle?: () => void
  testPrefix: string
}) {
  /** The open form: '' is the new-group form, else the group being edited. */
  const [form, setForm] = useState<{ name: string; value: string; description: string; problem: string | null } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const openNew = () => { setConfirm(null); setForm({ name: '', value: '', description: '', problem: null }) }
  const openEdit = (name: string) => { setConfirm(null); setForm({ name, value: name, description: groupInfo[name]?.description ?? '', problem: null }) }
  const close = () => { setForm(null); onIdle?.() }

  useEffect(() => {
    if (!request) return
    if (request.kind === 'new') openNew()
    else if (request.name && groups.includes(request.name)) openEdit(request.name)
    // The request is a one-shot: it is keyed by `n`, not by what is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n])

  // Escape arrives as tm-escape (App's rule in the workspace, the picker's own in its window) and cancels the form.
  useEffect(() => {
    const el = formRef.current
    if (!el) return
    const esc = () => close()
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.name, !!form])

  const problemFor = (value: string, current: string | null) => {
    const name = value.trim()
    if (!name) return null
    return groupProblem(name, groups, current)
  }

  const save = async () => {
    const f = form
    if (!f || busy) return
    const name = f.value.trim()
    const problem = name ? groupProblem(name, groups, f.name || null) : 'A name, to start with'
    if (problem) { setForm({ ...f, problem }); return }
    setBusy(true)
    try {
      let res: boolean | string
      if (f.name === '') res = await manage({ op: 'add', name, description: f.description })
      else {
        res = name === f.name ? true : await manage({ op: 'rename', name: f.name, to: name })
        if (res === true && f.description !== (groupInfo[f.name]?.description ?? '')) res = await manage({ op: 'describe', name, description: f.description })
      }
      if (res === true) close()
      else setForm((cur) => (cur ? { ...cur, problem: typeof res === 'string' ? res : 'That could not be saved' } : cur))
    } finally { setBusy(false) }
  }
  const remove = async (name: string) => {
    setConfirm(null)
    await manage({ op: 'remove', name })
    onIdle?.()
  }

  // Every key stays in the form (the picker's list keys must not fire); Escape goes on to the window, which sends tm-escape back.
  const keep = (e: ReactKeyboardEvent) => { if (e.key !== 'Escape') e.stopPropagation() }

  const formNode = form && (
    <form
      ref={formRef}
      className="cgroup-form"
      data-escape-close=""
      onSubmit={(e) => { e.preventDefault(); void save() }}
      data-testid={`${testPrefix}-form`}
    >
      <label className="clip-field">
        <span className="clip-field-label">{form.name === '' ? 'New group' : 'Name'}<span className="clip-field-aside">{form.value.trim().length}/{MAX_GROUP_NAME}</span></span>
        <input
          ref={nameRef}
          autoFocus
          className={`clip-field-input ${form.problem ? 'is-invalid' : ''}`}
          value={form.value}
          maxLength={MAX_GROUP_NAME}
          placeholder="Name"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!form.problem}
          onChange={(e) => setForm({ ...form, value: e.target.value, problem: problemFor(e.target.value, form.name || null) })}
          onKeyDown={keep}
          data-testid={`${testPrefix}-name`}
        />
      </label>
      <label className="clip-field">
        <span className="clip-field-label">Description<span className="clip-field-aside">shows on hover · {form.description.length}/{MAX_GROUP_DESCRIPTION}</span></span>
        <input
          className="clip-field-input"
          value={form.description}
          maxLength={MAX_GROUP_DESCRIPTION}
          placeholder="What goes in it (optional)"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onKeyDown={keep}
          data-testid={`${testPrefix}-description`}
        />
      </label>
      <div className="cgroup-form-foot">
        {form.problem && <span className="clip-editcard-error" role="alert" data-testid={`${testPrefix}-problem`}>{form.problem}</span>}
        <button type="button" className="picker-btn is-small" onClick={close} data-testid={`${testPrefix}-cancel`}>Cancel</button>
        <button type="submit" className="picker-btn is-small is-primary" disabled={busy || !form.value.trim() || !!form.problem} data-testid={`${testPrefix}-save`}>{form.name === '' ? 'Create' : 'Save'}</button>
      </div>
    </form>
  )

  return (
    <div className="cgroups" data-testid={testPrefix}>
      <div className="cgroups-head">
        <span className="cgroups-count" data-testid={`${testPrefix}-count`}>{groups.length === 0 ? 'No groups yet' : `${groups.length} group${groups.length === 1 ? '' : 's'}`}</span>
        <button type="button" className="picker-btn is-small" onClick={openNew} disabled={form?.name === ''} data-testid={`${testPrefix}-new`}><FolderPlus strokeWidth={2} style={{ width: 13, height: 13, marginRight: 5, verticalAlign: '-2px' }} />New group</button>
      </div>
      {form?.name === '' && formNode}
      {groups.length === 0 && form?.name !== '' && (
        <div className="cgroups-empty">A group is a chip in the picker and the Clipboard pane; a clip can sit in several. Its description shows when the chip is hovered.</div>
      )}
      <div className="cgroups-list">
        {groups.map((g) => {
          if (form && form.name === g) return <div key={g}>{formNode}</div>
          const n = count(g)
          const description = groupInfo[g]?.description
          if (confirm === g) {
            return (
              <div key={g} className="cgroup-confirm" role="alertdialog" data-testid={tid(`${testPrefix}-confirm`, g)}>
                <span>Delete “{g}”? {n ? `Its ${n} clip${n === 1 ? '' : 's'} stay in history.` : 'It holds no clips.'}</span>
                <button type="button" className="clip-confirm-yes" onClick={() => void remove(g)} data-testid={`${testPrefix}-confirm-yes`}>Delete</button>
                <button type="button" className="clip-confirm-no" onClick={() => { setConfirm(null); onIdle?.() }} data-testid={`${testPrefix}-confirm-no`}>Keep</button>
              </div>
            )
          }
          return (
            <div key={g} className="cgroup-row" title={description} data-testid={tid(`${testPrefix}-row`, g)}>
              <span className="clip-dot" style={{ background: dot(g) }} />
              <span className="cgroup-text">
                {onPick
                  ? <button type="button" className="cgroup-name" onClick={() => onPick(g)} title={`Show ${g}`} data-testid={tid(`${testPrefix}-pick`, g)}>{g}</button>
                  : <span className="cgroup-name">{g}</span>}
                {description && <span className="cgroup-desc" data-testid={tid(`${testPrefix}-desc`, g)}>{description}</span>}
              </span>
              <span className="cgroup-n" title={`${n} clip${n === 1 ? '' : 's'}`}>{n}</span>
              <span className="cgroup-tools">
                <button type="button" className="iconbtn iconbtn--sm" title="Edit name and description" aria-label={`Edit ${g}`} onClick={() => openEdit(g)} data-testid={tid(`${testPrefix}-edit`, g)}><Pencil className="gear gear--sm" strokeWidth={2} /></button>
                <button type="button" className="iconbtn iconbtn--sm" title="Delete group — its clips stay" aria-label={`Delete ${g}`} onClick={() => { setForm(null); setConfirm(g) }} data-testid={tid(`${testPrefix}-delete`, g)}><Trash2 className="gear gear--sm" strokeWidth={2} /></button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
