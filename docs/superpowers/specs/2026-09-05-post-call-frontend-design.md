# Frontend Post-Llamada (pestañas de revisión) — Design Spec

**Fecha:** 2026-09-05
**Sub-proyecto de:** MVP plataforma de videollamadas con IA (MeetAI)
**Estado:** Aprobado para implementación (rulings autónomos)

## Contexto

Cuarto y último sub-proyecto grande del MVP. Los anteriores dejan, para una
reunión terminada: `transcriptSegments`, `summaries`, `chapters`,
`highlights`, `proposedTasks` todos persistidos en Postgres. Este
sub-proyecto construye la UI para revisar todo eso: reproductor +
pestañas Speakers/Chapters/Highlights/Summary/Transcript/Approvals.

No existe todavía ningún endpoint que devuelva estos datos juntos para una
reunión — se agrega en este sub-proyecto.

## Rulings de alcance (YAGNI, dado el tamaño ya grande del MVP)

Se implementan las pestañas que agregan valor demostrable con el dato ya
existente en la base:

- **Speakers, Chapters, Highlights, Summary, Transcript, Approvals**: sí,
  se implementan — el dato para todas ya existe en el modelo.
- **Insights**: se implementa en su versión mínima explícita del spec
  original ("dejar solo lo básico: tiempo total, participación por
  persona") — calculado en el frontend a partir de `transcriptSegments`,
  sin tabla nueva ni endpoint nuevo.
- **Enhanced notes (editor con barra de IA inline)** y **citas destacadas
  superpuestas durante la reproducción**: quedan FUERA de este sub-proyecto.
  Son las dos features más costosas de la lista original (editor de texto
  enriquecido con generación de IA inline, y overlays sincronizados
  cuadro a cuadro con el video) y no tienen dependencia de datos que ya no
  exista — se pueden agregar después sin rediseñar nada de lo construido acá.
  Esto es una decisión de alcance, no una limitación técnica descubierta.
- **Reproductor de video real con seek a video real**: el MVP reproduce el
  **audio** por pista (no hay archivo de video compuesto en el pipeline
  actual — Egress graba audio por pista, no video). El "reproductor" de
  este sub-proyecto es un reproductor de audio con timeline y marcadores de
  hablante, no un reproductor de video con miniaturas. Los "Highlights"
  muestran texto/cita, no miniatura de video (el spec original pedía
  miniatura de video para Highlights — eso requeriría grabación de video
  compuesta, que no está en el pipeline actual). Ruling: se deja como deuda
  explícita para cuando exista una grabación de video compuesta.

## Arquitectura

```
Backend: GET /meetings/:id/full
  → devuelve { meeting, participants, transcriptSegments, chapters,
               highlights, summary, proposedTasks }

Frontend: nueva app o vista dentro de la ya existente (frontend/)
  → MeetingReview.tsx: fetch a /meetings/:id/full, arma las pestañas
  → AudioPlayer.tsx: reproduce el audio de la primera pista disponible
    (o de una pista "compuesta" si existiera), con línea de tiempo
    marcada por cambios de hablante (a partir de transcriptSegments)
  → Tabs: SpeakersTab, ChaptersTab, HighlightsTab, SummaryTab,
    TranscriptTab, ApprovalsTab, InsightsTab
```

## Ruling técnico sobre el audio reproducible

El pipeline actual graba una pista de audio por participante en S3, pero
no compone un único archivo reproducible de "la reunión completa". Para
que el reproductor tenga sentido en el MVP, se agrega al backend:
`recordingUrl` en `Meeting` ya existe en el schema (del sub-proyecto 1)
pero nunca se completa. Ruling: en este sub-proyecto, `GET /meetings/:id/full`
devuelve también un array `tracks: [{ participantId, url }]` (las URLs de
S3 de cada pista, ya conocidas por `TranscriptionJob`), y el reproductor
del frontend reproduce **la pista del primer participante** como
aproximación de MVP (mezclar N pistas de audio en el cliente está fuera de
alcance). Esto es una limitación conocida y documentada, no un bug.

## Componentes

- **Backend**: `src/routes/meetingData.ts` → `GET /meetings/:id/full`.
- **Frontend** (`frontend/src/MeetingReview.tsx` + subcomponentes en
  `frontend/src/tabs/`): fetch inicial, estado de pestaña activa,
  reproductor de audio compartido (referencia a `<audio>` controlada por
  contexto simple, sin librería de state management nueva).

## Testing

- Backend: test de `GET /meetings/:id/full` (mock de Drizzle) verificando
  que agrega correctamente las 6 entidades relacionadas y arma el array
  `tracks`.
- Frontend: sin test automatizado por la naturaleza visual (igual criterio
  que el sub-proyecto de sala en vivo) — verificación manual con datos de
  una reunión de prueba ya procesada por el pipeline.

## Fuera de alcance

- Enhanced notes con IA inline.
- Citas superpuestas sincronizadas con reproducción.
- Miniaturas de video en Highlights (no hay grabación de video compuesta).
- Mezcla de múltiples pistas de audio en un único reproductor sincronizado.
