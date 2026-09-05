# Pipeline de Transcripción + Diarización — Design Spec

**Fecha:** 2026-09-05
**Sub-proyecto de:** MVP plataforma de videollamadas con IA (MeetAI)
**Estado:** Aprobado para implementación

## Contexto

Este es el primer sub-proyecto del MVP, elegido por ser el de mayor riesgo técnico:
resolver la diarización (quién dijo qué) sin depender de tecnología de Meta
(pyannote/wav2vec2, Muse Voice Transcribe), y producir una transcripción etiquetada
por speaker lista para que un LLM genere resúmenes y tareas.

Alcance: desde que termina la grabación de LiveKit Egress hasta tener
`TranscriptSegment[]` persistidos en Postgres, listos para el paso de IA
(resumen/tareas), que se especifica en un sub-proyecto separado.

## Decisión clave: diarización sin clustering acústico

LiveKit Egress graba **una pista de audio individual por participante**. Esto
resuelve la diarización sin necesidad de VAD + speaker embeddings + clustering:
cada pista transcripta se etiqueta directamente con el participante dueño de esa
pista.

El pipeline de diarización acústica (Silero VAD + SpeechBrain/NeMo + agglomerative
clustering) queda **fuera del MVP** (YAGNI): no hay caso de uso hoy con audio
mezclado sin pista individual (ej. participante por teléfono). Si aparece, se
integra sin romper el diseño porque el merge trabaja sobre `{speaker, start, end,
text}` sin importar el origen del speaker.

## Arquitectura

Servicio orquestador en **Node.js/TypeScript**, sin descargar bytes de audio en
ningún momento: se apoya en las capacidades remotas y asíncronas de Deepgram.

```
LiveKit Egress (fin de grabación)
  → webhook egress_ended (URLs de pistas en S3)
  → por cada pista: Deepgram POST /v1/listen?callback=... (remote + async)
  → Deepgram procesa y hace POST a nuestro callback cuando termina cada pista
  → cuando todas las pistas de la reunión están completed/failed/timeout:
      merge de segments → AI processor (sub-proyecto aparte) → persist
```

## Componentes

- **Webhook receiver** (`POST /webhooks/livekit-egress`): valida firma de LiveKit,
  procesa evento `egress_ended` con status `EGRESS_COMPLETE`. Encola el trabajo
  (no procesa inline) para evitar timeouts.
- **Transcriber (dispatcher)**: por cada pista, llama a Deepgram Nova-3
  `POST /v1/listen` en modo remoto (`url` = ubicación en S3, sin diarización
  activada) con `callback` apuntando a
  `https://<backend>/webhooks/deepgram?meetingId=X&trackId=Y` (firmado con token
  para no confiar solo en query params). Crea
  `TranscriptionJob(meetingId, trackId, participantId, deepgramRequestId, status)`.
- **Deepgram callback receiver** (`POST /webhooks/deepgram`): recibe el POST
  asíncrono de Deepgram con `words` (timestamps por palabra). Valida
  `request_id` contra el `TranscriptionJob` pendiente, persiste `words` crudos,
  marca `completed`. Idempotente (Deepgram puede reintentar el POST).
- **Merger**: se dispara cuando todos los `TranscriptionJob` de una reunión están
  en estado terminal (`completed`, `failed` o `timeout`). Agrupa `words` en
  `TranscriptSegment[]` por pausas naturales (gap > 1.5s = nuevo segmento) por
  pista, y mergea todas las pistas ordenando por `start` global.
- **Timeout sweeper**: job periódico que marca como `timeout` los
  `TranscriptionJob` sin callback recibido tras 15 min, y dispara el merge igual
  (no bloquea toda la reunión por una pista colgada).
- **Persister**: guarda `TranscriptSegment[]` en Postgres dentro de una
  transacción.

## Modelo de datos (este sub-proyecto)

- `Meeting(id, título, fecha/hora inicio-fin, url_grabación)`
- `Participant(id, nombre, meeting_id)`
- `TranscriptionJob(id, meeting_id, track_id, participant_id, deepgram_request_id, status: pending|completed|failed|timeout)`
- `TranscriptSegment(meeting_id, speaker_id, start, end, texto)`

## Manejo de errores

- Falla de Deepgram al aceptar el request inicial: reintento con backoff (3
  intentos). Si sigue fallando, `TranscriptionJob.status = failed`, pero no
  bloquea las demás pistas.
- Callback nunca llega: cubierto por el timeout sweeper.
- Callback duplicado: se chequea `status` antes de reprocesar (idempotencia).

## Testing

- Unit tests del merger: agrupamiento por pausas y orden multi-pista, con
  fixtures de `words` simulados (no depende de red).
- Test de idempotencia del callback receiver (POST duplicado no debe duplicar
  segments).
- Test de integración manual (no en CI, requiere audio real) para validar
  correcta atribución de 2-3 hablantes distintos — corresponde al criterio de
  aceptación general del MVP.

## Fuera de alcance de este sub-proyecto

- Pipeline de diarización acústica (VAD+embeddings+clustering) para audio sin
  pista individual.
- Generación de resumen/capítulos/highlights/tareas (sub-proyecto de IA aparte,
  consume `TranscriptSegment[]` producidos acá).
- UI de reproducción/transcripción (sub-proyecto de frontend aparte).
