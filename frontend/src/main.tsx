import React from 'react'
import ReactDOM from 'react-dom/client'
import '@livekit/components-styles'
import { JoinRoom } from './JoinRoom.js'
import { MeetingReview } from './MeetingReview.js'

const meetingId = new URLSearchParams(window.location.search).get('meeting')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {meetingId ? <MeetingReview meetingId={meetingId} /> : <JoinRoom />}
  </React.StrictMode>
)
