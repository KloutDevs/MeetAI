import React from 'react'
import ReactDOM from 'react-dom/client'
import '@livekit/components-styles'
import { JoinRoom } from './JoinRoom.js'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <JoinRoom />
  </React.StrictMode>
)
