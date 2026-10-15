import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { FolderPlus, Layers, Pencil, Trash2 } from 'lucide-react'
import { groupProblem, MAX_GROUP_DESCRIPTION, MAX_GROUP_NAME } from '@shared/clips.mjs'
import { dropSlot, moveTo } from '@shared/reorder.mjs'
import type { ClipGroupInfo, ClipGroupOp } from '@shared/types'
import { tid } from '../testid'

/** What the caller wants opened on arrival (or later: `n` moves for each new ask, so the same request can repeat). */
export interface GroupRequest {
  kind: 'new' | 'edit'
  name?: string
  n: number
}

/** A press that travels this far is a drag, not a click. */
const DRAG_PX = 5

/**
 * The groups, managed: the same chips the filter row shows (dot · name ·
 * count), in the order both windows list them — **drag a chip to reorder**
 * (one `reorder` write on release; the filter rows follow). A click selects
 * a chip and opens its card underneath: the description, how many clips
 * carry it, Edit, Show clips, Delete. New group and Edit are inline forms
 * (name + description; never a dialog, the picker is a popup), Delete an
 * inline confirm. Shared by the picker's Settings → Groups page and the
 * pane's More → Manage groups… card: every change is one `clips:group`
 * call, and what shows is whatever `clips:changed` brings back — nothing
 * is held here. The description is the hover text of the chip everywhere.
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
  /** The card's Show clips: filter the list to the group. */
  onPick?: (name: string) => void
  /** A form or confirm closed: the caller may want focus back. */
  onIdle?: () => void
  testPrefix: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  /** The open form: name '' is the new-group form, else the group being edited. */
  const [form, setForm] = useState<{ name: string; value: string; description: string; problem: string | null } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // A selection outlives a rename only by accident; a gone group drops it.
  useEffect(() => { if (selected && !groups.includes(selected)) setSelected(null) }, [groups, selected])

  const openNew = () => { setConfirm(null); setSelected(null); setForm({ name: '', value: '', description: '', problem: null }) }
  const openEdit = (name: string) => { setConfirm(null); setSelected(name); setForm({ name, value: name, description: groupInfo[name]?.description ?? '', problem: null }) }
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
      if (res === true) { if (f.name !== '') setSelected(name); close() }
      else setForm((cur) => (cur ? { ...cur, problem: typeof res === 'string' ? res : 'That could not be saved' } : cur))
    } finally { setBusy(false) }
  }
  const remove = async (name: string) => {
    setConfirm(null)
    setSelected(null)
    await manage({ op: 'remove', name })
    onIdle?.()
  }

  // ---- the chips: a press that travels is a drag; release drops it into the slot under the pointer ----
  const cloudRef = useRef<HTMLDivElement>(null)
  const press = useRef<{ name: string; index: number; x: number; y: number; moved: boolean } | null>(null)
  /** The click that follows a drag's release must not select the chip. */
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<{ name: string; marker: { left: number; top: number; height: number } | null } | null>(null)
  const chipRects = () => [...(cloudRef.current?.querySelectorAll<HTMLElement>('[data-group]') ?? [])].map((el) => el.getBoundingClientRect())
  const onChipDown = (e: ReactPointerEvent<HTMLButtonElement>, name: string, index: number) => {
    if (e.button !== 0) return
    press.current = { name, index, x: e.clientX, y: e.clientY, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer has no capture; the move still tracks */ }
  }
  const onChipMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p) return
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_PX) return
      p.moved = true
    }
    const rects = chipRects()
    const host = cloudRef.current?.getBoundingClientRect()
    let marker: { left: number; top: number; height: number } | null = null
    if (host && rects.length) {
      const slot = dropSlot(rects, e.clientX, e.clientY)
      const at = slot < rects.length ? rects[slot] : null
      const ref = at ?? rects[rects.length - 1]
      marker = { left: (at ? at.left - 4 : ref.right + 2) - host.left, top: ref.top - host.top, height: ref.height }
    }
    setDrag({ name: p.name, marker })
  }
  const endDrag = () => { press.current = null; setDrag(null) }
  const onChipUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p) return
    if (p.moved) {
      suppressClick.current = true
      // The slot from the release point, not the lagging state; the chips never moved, so their rects are the list's.
      const next = moveTo(groups, p.index, dropSlot(chipRects(), e.clientX, e.clientY))
      if (next !== groups) void manage({ op: 'reorder', names: next })
    }
    endDrag()
  }
  const pickChip = (name: string) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    setConfirm(null)
    setForm(null)
    setSelected((cur) => (cur === name ? null : name))
  }
  const chipKey = (e: ReactKeyboardEvent<HTMLButtonElement>, name: string, index: number) => {
    if (e.key === 'Escape' && press.current) { e.stopPropagation(); endDrag(); return }
    // Alt+← / Alt+→ moves the chip a slot without a pointer.
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      e.stopPropagation()
      const next = moveTo(groups, index, e.key === 'ArrowLeft' ? index - 1 : index + 2)
      if (next !== groups) { setSelected(name); void manage({ op: 'reorder', names: next }) }
    }
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

  const n = selected ? count(selected) : 0
  const description = selected ? groupInfo[selected]?.description : undefined
  const card = selected && !form && (
    <div className="cgroup-card" data-testid={tid(`${testPrefix}-card`, selected)}>
      <div className="cgroup-card-head">
        <span className="clip-dot" style={{ background: dot(selected) }} />
        <span className="cgroup-name">{selected}</span>
        <span className="cgroup-n" title={`${n} clip${n === 1 ? '' : 's'}`}>{n}</span>
      </div>
      <div className={`cgroup-card-desc ${description ? '' : 'is-empty'}`} data-testid={tid(`${testPrefix}-desc`, selected)}>
        {description ?? 'No description yet — it shows when the chip is hovered.'}
      </div>
      {confirm === selected ? (
        <div className="cgroup-confirm" role="alertdialog" data-testid={tid(`${testPrefix}-confirm`, selected)}>
          <span>Delete “{selected}”? {n ? `Its ${n} clip${n === 1 ? '' : 's'} stay in history.` : 'It holds no clips.'}</span>
          <button type="button" className="clip-confirm-yes" onClick={() => void remove(selected)} data-testid={`${testPrefix}-confirm-yes`}>Delete</button>
          <button type="button" className="clip-confirm-no" onClick={() => { setConfirm(null); onIdle?.() }} data-testid={`${testPrefix}-confirm-no`}>Keep</button>
        </div>
      ) : (
        <div className="cgroup-card-actions">
          <button type="button" className="picker-btn is-small" onClick={() => openEdit(selected)} data-testid={tid(`${testPrefix}-edit`, selected)}><Pencil strokeWidth={2} />Edit</button>
          {onPick && <button type="button" className="picker-btn is-small" onClick={() => onPick(selected)} data-testid={tid(`${testPrefix}-pick`, selected)}><Layers strokeWidth={2} />Show clips</button>}
          <button type="button" className="picker-btn is-small cgroup-card-delete" onClick={() => setConfirm(selected)} data-testid={tid(`${testPrefix}-delete`, selected)}><Trash2 strokeWidth={2} />Delete</button>
        </div>
      )}
    </div>
  )

  return (
    <div className="cgroups" data-testid={testPrefix}>
      <div className="cgroups-head">
        <span className="cgroups-count" data-testid={`${testPrefix}-count`}>{groups.length === 0 ? 'No groups yet' : `${groups.length} group${groups.length === 1 ? '' : 's'} — drag to reorder`}</span>
        <button type="button" className="picker-btn is-small" onClick={openNew} disabled={form?.name === ''} data-testid={`${testPrefix}-new`}><FolderPlus strokeWidth={2} />New group</button>
      </div>
      {groups.length > 0 && (
        <div
          className={`cgroups-cloud ${drag ? 'is-reordering' : ''}`}
          ref={cloudRef}
          role="listbox"
          aria-label="Groups — drag a chip to reorder"
          data-testid={`${testPrefix}-chips`}
        >
          {groups.map((g, index) => (
            <button
              key={g}
              type="button"
              role="option"
              aria-selected={selected === g}
              data-group={g}
              className={`picker-chip cgroup-chip ${selected === g ? 'is-active' : ''} ${drag?.name === g ? 'is-dragging' : ''}`}
              title={groupInfo[g]?.description ?? 'Click for its card; drag to reorder'}
              onPointerDown={(e) => onChipDown(e, g, index)}
              onPointerMove={onChipMove}
              onPointerUp={onChipUp}
              onPointerCancel={endDrag}
              onClick={() => pickChip(g)}
              onKeyDown={(e) => chipKey(e, g, index)}
              data-testid={tid(`${testPrefix}-chip`, g)}
            >
              <span className="clip-dot" style={{ background: dot(g) }} />
              <span className="picker-chip-label">{g}</span>
              <span className="picker-chip-n">{count(g)}</span>
            </button>
          ))}
          {drag?.marker && <span className="cgroups-drop" aria-hidden style={{ left: drag.marker.left, top: drag.marker.top, height: drag.marker.height }} />}
        </div>
      )}
      {groups.length === 0 && form?.name !== '' && (
        <div className="cgroups-empty">A group is a chip in the picker and the Clipboard pane; a clip can sit in several. Its description shows when the chip is hovered.</div>
      )}
      {formNode}
      {card}
    </div>
  )
}
