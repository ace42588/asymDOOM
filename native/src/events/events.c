#include "events.h"
#include <string.h>

void asym_events_init(asym_event_queue *q)
{
    memset(q, 0, sizeof(*q));
}

void asym_events_clear(asym_event_queue *q)
{
    asym_events_init(q);
}

void asym_events_push(asym_event_queue *q, const asym_event *ev)
{
    if (!q || !ev) return;
    if (q->count >= ASYM_EVENT_QUEUE_CAP) {
        /* Drop oldest */
        q->head = (q->head + 1) % ASYM_EVENT_QUEUE_CAP;
        q->count--;
    }
    q->items[q->tail] = *ev;
    q->tail = (q->tail + 1) % ASYM_EVENT_QUEUE_CAP;
    q->count++;
}

int asym_events_drain(asym_event_queue *q, asym_event *out, int max_out)
{
    int n = 0;
    if (!q || !out || max_out <= 0) return 0;
    while (q->count > 0 && n < max_out) {
        out[n++] = q->items[q->head];
        q->head = (q->head + 1) % ASYM_EVENT_QUEUE_CAP;
        q->count--;
    }
    return n;
}

void asym_event_make(asym_event *ev, int kind, const char *session_id,
                     uint32_t body_id, const char *species, const char *reason)
{
    memset(ev, 0, sizeof(*ev));
    ev->kind = kind;
    ev->body_id = body_id;
    if (session_id) {
        strncpy(ev->session_id, session_id, ASYM_SESSION_ID_LEN - 1);
    }
    if (species) {
        strncpy(ev->species, species, sizeof(ev->species) - 1);
    }
    if (reason) {
        strncpy(ev->reason, reason, sizeof(ev->reason) - 1);
    }
}
