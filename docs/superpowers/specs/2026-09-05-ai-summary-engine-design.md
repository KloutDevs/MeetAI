# Motor de IA — Resúmenes + Extracción de Tareas — Design Spec

**Fecha:** 2026-09-05
**Sub-proyecto de:** MVP plataforma de videollamadas con IA (MeetAI)
**Estado:** Aprobado para implementación (rulings autónomos)

## Contexto

Tercer sub-proyecto. Los dos anteriores dejan `TranscriptSegment[]` persistidos
en Postgres una vez que termina una reunión (pipeline de transcripción +
diarización) y una sala en vivo que graba por pista (LiveKit room/session).
Este sub-proyecto agrega la capa de IA: a partir de la transcripción
etiquetada por speaker, generar resumen ejecutivo, capítulos, highlights y
una lista de tareas propuestas (estado `pendiente`), más el endpoint para
aprobarlas y convertirlas en `Task` reales.

## Rulings (decisiones tomadas de forma autónoma)

- **Trigger:** se engancha al mismo punto donde hoy `checkMeetingCompletion`
  persiste los `transcriptSegments` — inmediatamente después de esa
  persistencia exitosa, se dispara el AI processor de forma asíncrona
  (fire-and-forget vía una función separada, no bloquea la respuesta del
  webhook de Deepgram).
- **Proveedor LLM:** DeepSeek V4 (ya decidido en la conversación original),
  vía su API compatible con OpenAI (`https://api.deepseek.com/chat/completions`,
  modelo `deepseek-chat`), pidiendo `response_format: { type: 'json_object' }`
  y validando la respuesta con un schema Zod.
- **Prompt:** un único prompt con la transcripción completa (formato
  `[mm:ss] speakerId: texto` por línea) más instrucciones de generar JSON
  con: `summary` (contexto + lo más importante), `chapters[]`
  (title, start, end), `highlights[]` (type, timestamp, quote), `proposedTasks[]`
  (description, sourceQuote, sourceSpeakerId, sourceTimestamp).
- **Reintentos:** si el JSON no valida contra el schema, se reintenta una
  vez incluyendo el error de validación en el prompt (self-healing, ya
  usado como patrón en el sub-proyecto 1). Si vuelve a fallar, se guarda la
  transcripción igual (ya persistida) y el registro de IA queda en estado
  `failed` — no se reintenta indefinidamente en este MVP.
- **Aprobación de tareas:** un endpoint `POST /proposed-tasks/:id/approve`
  con body opcional `{ assignee?: string }` que crea una `Task` real y
  marca el `ProposedTask` como `aprobada`. Sin editor de fecha en este MVP
  (fuera de alcance explícito del spec original: "opcionalmente editar
  asignado/fecha" — se deja solo `assignee`, YAGNI en fecha por ahora).
- **Rechazo de tareas:** `POST /proposed-tasks/:id/reject` simplemente marca
  `rechazada`, sin crear nada.

## Arquitectura

```
checkMeetingCompletion persiste transcriptSegments
  → (mismo proceso, fire-and-forget) generateMeetingSummary(meetingId)
    → arma transcripción completa desde transcriptSegments
    → llama a DeepSeek con el prompt + schema esperado
    → valida JSON con Zod (1 reintento con error de validación si falla)
    → persiste Summary, Chapter[], Highlight[], ProposedTask[]
    → si falla tras el reintento: persiste Summary con status='failed'

Frontend/API: POST /proposed-tasks/:id/approve → crea Task real
Frontend/API: POST /proposed-tasks/:id/reject → marca rechazada
GET /meetings/:id/summary → devuelve summary+chapters+highlights+proposedTasks
```

## Modelo de datos (nuevo, este sub-proyecto)

- `Summary(meetingId, context, keyPoints, status: pending|completed|failed)`
- `Chapter(meetingId, title, start, end)`
- `Highlight(meetingId, type, timestamp, quote)`
- `ProposedTask(id, meetingId, description, sourceSpeakerId, sourceTimestamp, sourceQuote, status: pendiente|aprobada|rechazada, assignee)`
- `Task(id, proposedTaskId, description, assignee, createdAt)`

## Manejo de errores

- Timeout/error de red al llamar a DeepSeek: 1 reintento con backoff simple;
  si falla, `Summary.status = 'failed'`, no bloquea nada más (la
  transcripción ya está guardada y disponible independientemente del éxito
  de esta capa).
- JSON inválido: 1 reintento con el error de Zod embebido en el prompt;
  igual criterio de `failed` si persiste.

## Testing

- Unit test del formateador de transcripción a texto plano por prompt.
- Unit test del parseo+validación Zod de la respuesta del LLM (mock de
  fetch), incluyendo el caso de reintento por JSON inválido.
- Unit test de `POST /proposed-tasks/:id/approve` (crea Task, marca
  aprobada) y `/reject` (solo marca rechazada, no crea Task).
- Test manual de integración (no CI): reunión real de prueba → verificar
  que aparece al menos una tarea propuesta y que aprobarla crea una tarea
  real.

## Fuera de alcance

- Edición de fecha de vencimiento en la aprobación.
- Multi-idioma amplio (el prompt asume español/inglés, igual que el resto
  del MVP).
- UI (sub-proyecto de frontend aparte, después de este).
