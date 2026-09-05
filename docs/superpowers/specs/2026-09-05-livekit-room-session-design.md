# LiveKit Room + Session Management — Design Spec

**Fecha:** 2026-09-05
**Sub-proyecto de:** MVP plataforma de videollamadas con IA (MeetAI)
**Estado:** Aprobado para implementación (rulings autónomos, ver abajo)

## Contexto

Segundo sub-proyecto del MVP. El primero (transcripción + diarización) asume
que existe una `Meeting`, `Participant`s, y que LiveKit Egress ya grabó
pistas de audio individuales subidas a S3. Este sub-proyecto construye la
pieza que falta antes de eso: crear la sala, dejar entrar participantes, y
arrancar el egress por pista de audio al empezar a hablar.

También cierra deuda documentada explícitamente en el sub-proyecto anterior:
`resolveParticipantId` en `livekitWebhook.ts` era un stub
(`trackFilename.split('.')[0]`) que solo funciona si el nombre del archivo
en S3 ya es el UUID real del participante.

## Rulings (decisiones tomadas sin consulta, por instrucción explícita del usuario de avanzar de forma autónoma)

- **Cierre de deuda del stub:** al arrancar el track egress de una pista de
  audio, el archivo de salida en S3 se nombra `{meetingId}/{participantId}.ogg`
  usando el UUID real de `Participant` (ya generado al emitir el token de
  join). Esto hace que `resolveParticipantId` (ya implementado) funcione
  correctamente sin tocar el pipeline de transcripción.
- **Trigger del egress por pista:** se usa el webhook `track_published` de
  LiveKit (participante publica su pista de audio) para llamar
  `EgressClient.startTrackEgress` por esa pista específica. Evita tener que
  mantener un `RoomCompositeEgress` corriendo todo el tiempo y generar
  archivos individuales después con post-procesamiento.
- **Identidad de participante en LiveKit:** al emitir el token de acceso
  (`AccessToken`), la `identity` del participante en LiveKit se fija al
  UUID de la fila `Participant` en Postgres. Esto permite, en el webhook
  `track_published`, resolver `participantId` directamente desde
  `event.participant.identity` sin tabla de mapeo adicional.
- **Alcance de la UI en este sub-proyecto:** solo una página mínima de unirse
  a la sala (grid de participantes vía `@livekit/components-react`, mute,
  cámara, salir). Las 9 pestañas de post-llamada (Summary, Transcript,
  Approvals, etc.) son sub-proyecto de frontend aparte, ya planificado para
  después del motor de IA.
- **Grabación activada por defecto:** al crear la sala (`POST /rooms`), el
  backend no espera un "start recording" manual — el egress por pista arranca
  automáticamente en cuanto el primer participante publica audio, cumpliendo
  el criterio de aceptación "grabación activada por defecto".

## Arquitectura

```
Frontend: POST /rooms { title } → Meeting creada, LiveKit room creada
Frontend: POST /rooms/:meetingId/token { participantName }
  → Participant creado (uuid), AccessToken de LiveKit con identity=participantId
Frontend: se conecta a la sala con ese token (livekit-client)
LiveKit Cloud: al publicarse una pista de audio → webhook track_published
Backend: recibe track_published → EgressClient.startTrackEgress
  con output S3 = {meetingId}/{participantId}.ogg
LiveKit Cloud: al terminar la reunión → egress_ended (ya implementado,
  sub-proyecto 1) → dispara el pipeline de transcripción existente,
  ahora con resolveParticipantId funcionando correctamente porque el
  filename YA es el participantId real.
```

## Componentes

- **`src/services/livekitRoom.ts`**: `createMeetingRoom(title): Promise<{meetingId, roomName}>`
  (crea `Meeting` en Postgres + `RoomServiceClient.createRoom`),
  `issueParticipantToken(meetingId, participantName): Promise<{participantId, token}>`
  (crea `Participant` en Postgres + `AccessToken` con `identity = participantId`).
- **`src/routes/rooms.ts`**: `POST /rooms` (crea meeting), `POST /rooms/:meetingId/token` (crea participant + token).
- **`src/routes/livekitWebhook.ts` (extendido)**: nuevo manejo del evento
  `track_published` — si `track.type === 'audio'`, llama
  `EgressClient.startTrackEgress(roomName, { trackId: track.sid }, { filepath: \`${meetingId}/${participantId}.ogg\` })`,
  usando `event.participant.identity` como `participantId`.
- **Frontend mínimo** (`frontend/src/JoinRoom.tsx`): formulario de nombre →
  POST a `/rooms/:meetingId/token` → conecta con `livekit-client` → grid de
  video vía `@livekit/components-react`, controles de mute/cámara/salir.

## Manejo de errores

- Si `startTrackEgress` falla al publicarse una pista, se loguea el error
  pero no se corta la llamada — la sesión sigue en vivo sin grabar esa pista
  puntual (mejor una reunión parcialmente grabada que cortar la experiencia).
- Si el participante se desconecta antes de que el egress termine de subir,
  LiveKit Cloud maneja el cierre del egress internamente (fuera de nuestro
  control) y dispara `egress_ended` igual para las pistas que sí se cerraron
  bien.

## Testing

- Unit tests de `livekitRoom.ts`: `createMeetingRoom` inserta en Postgres y
  llama `RoomServiceClient.createRoom` con el nombre correcto (mocks);
  `issueParticipantToken` inserta `Participant` y genera un JWT con
  `identity` igual al id insertado (verificable decodificando el token).
- Unit test de la extensión a `livekitWebhook.ts`: evento `track_published`
  con `track.type === 'audio'` llama `startTrackEgress` con el filepath
  esperado; evento con `track.type === 'video'` no llama nada.
- Test manual de integración (no CI): unirse desde el navegador con dos
  pestañas, verificar que las dos pistas de audio arrancan egress por
  separado.

## Fuera de alcance de este sub-proyecto

- UI de post-llamada (Summary, Transcript, Approvals, etc.) — sub-proyecto
  de frontend aparte.
- Motor de IA (resumen, capítulos, tareas propuestas) — sub-proyecto aparte.
- Manejo de reconexión/resiliencia de red avanzado en el cliente de video.
