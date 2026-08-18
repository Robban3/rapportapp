import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { applicera } from './lib/tema.js'
import { SessionProvider } from './state/session.jsx'
import './index.css'

// Temat skrivs på <html> innan React monterar, annars blinkar en vit skärm
// förbi innan det mörka läget slår till — precis det man inte vill kl 02:00.
applicera()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>
)
