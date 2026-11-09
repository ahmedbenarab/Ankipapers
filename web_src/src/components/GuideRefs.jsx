import React from 'react'

// The rows the guide is made of; the home page's Start here banner uses them too.

/** One row of the guide: the thing you type, and what it does for you. */
export function Ref({ code, tone, children }) {
  return (
    <div className="welcome-ref-row">
      <code className={`welcome-ref-code${tone ? ` is-${tone}` : ''}`}>{code}</code>
      <span className="welcome-ref-text">{children}</span>
    </div>
  )
}

export function RefGroup({ icon, title, blurb, children }) {
  return (
    <div className="welcome-ref-group">
      <h3 className="welcome-ref-group-title">{React.createElement(icon, { size: 13 })} {title}</h3>
      {blurb ? <p className="welcome-ref-blurb">{blurb}</p> : null}
      {children}
    </div>
  )
}
