// import '@/lib/zodConfig'
// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import './index.css'
// import App from './App.tsx'
// import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
// import { installErrorReporter } from '@/services/errorReporter'

// installErrorReporter()

// createRoot(document.getElementById('root')!).render(
//   <StrictMode>
//     <ErrorBoundary><App /></ErrorBoundary>
//   </StrictMode>,
// )

// // The app shell is saved by the service worker so the site still opens with no data (the student's offline meal code lives
// // on that). Registered once the page has loaded so it never competes with first paint; production only, where the worker's
// // caching can't get in the way of the dev server's hot reload.
// if (import.meta.env.PROD && 'serviceWorker' in navigator) {
//   window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* push and offline mode simply stay off */ }) })
// }


import '@/lib/zodConfig'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { installErrorReporter } from '@/services/errorReporter'

try {
  installErrorReporter()
} catch (error) {
  console.error('Error reporter initialization failed:', error)
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('React root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

// Register service worker in production
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((error) => {
        console.error('Service worker registration failed:', error)
      })
  })
}
