import React from 'react'

export default function Toast({ message, type = 'success' }) {
  return (
    <div className={`toast ${type}`}>
      {type === 'success' ? '✅' : '❌'} {message}
    </div>
  )
}
