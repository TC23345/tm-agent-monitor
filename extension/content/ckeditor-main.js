// TaylorMade Clipboard — the CKEditor 5 adapter, in the page's own world
// (`"world": "MAIN"`) because the editor instance only exists there. It
// listens for one event the isolated page script dispatches and touches
// nothing but the focused editable's `ckeditorInstance`. No page globals
// are read, nothing is sent anywhere.
;(function () {
  'use strict'
  window.addEventListener('tm-clip-insert', (event) => {
    const detail = event && event.detail
    if (!detail || typeof detail.text !== 'string') return
    const host = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ck-editor__editable')
    const editor = host && host.ckeditorInstance
    if (!editor || typeof editor.execute !== 'function') return
    try {
      const erase = Number(detail.erase) || 0
      if (erase > 0) {
        // Remove the typed shortcut first: extend the selection backwards, then let insertText replace it.
        editor.model.change((writer) => {
          const pos = editor.model.document.selection.getFirstPosition()
          const start = pos.getShiftedBy(-erase)
          writer.setSelection(writer.createRange(start, pos))
        })
      }
      editor.execute('insertText', { text: detail.text })
    } catch { /* an editor mid-teardown */ }
  })
})()
