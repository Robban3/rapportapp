import { Component } from 'react'

// Utan den här blir varje oväntat fel en vit skärm. En värd mitt i ett pass
// har varken tid eller möjlighet att felsöka — hen behöver veta att något
// gick fel och kunna ta sig vidare.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { fel: null }
  }

  static getDerivedStateFromError(fel) {
    return { fel }
  }

  componentDidCatch(fel, info) {
    console.error('Ohanterat fel i gränssnittet', fel, info)
  }

  render() {
    if (!this.state.fel) return this.props.children

    return (
      <div className="empty" role="alert">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Något gick fel</div>
        <div style={{ marginBottom: 14 }}>
          Sidan kunde inte visas. Dina redan sparade inlägg finns kvar.
        </div>
        <button className="btn" onClick={() => window.location.reload()}>Ladda om appen</button>
      </div>
    )
  }
}
