import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { installPageLog } from './lib/pageLog'

installPageLog()

// In the desktop manager, pages without OpenPres's top bar (login, server list, setup) get
// the window buttons floating in the corner (tauri/src/titlebar.js); the top bar has a place for them.
document.documentElement.dataset.windowChrome = 'overlay'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
