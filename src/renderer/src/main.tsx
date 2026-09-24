import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Picker } from './picker/Picker'
import './styles.css'

// One renderer bundle, two windows: main opens the quick picker as
// `index.html?window=picker`, which mounts <Picker/> instead of the workspace
// and marks the root so the CSS drops the workspace chrome. The picker's
// preload exposes `window.picker`, the workspace's `window.watch`.
const which = new URLSearchParams(window.location.search).get('window')
const picker = which === 'picker'
if (picker) document.documentElement.dataset.window = 'picker'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {picker ? <Picker /> : <App />}
  </React.StrictMode>
)
