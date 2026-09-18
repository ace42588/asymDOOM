#ifndef ASYM_EVENTS_H
#define ASYM_EVENTS_H

#include "asym_embed.h"

#define ASYM_EVENT_QUEUE_CAP 128

typedef struct asym_event_queue {
    asym_event items[ASYM_EVENT_QUEUE_CAP];
    int head;
    int tail;
    int count;
} asym_event_queue;

void asym_events_init(asym_event_queue *q);
void asym_events_push(asym_event_queue *q, const asym_event *ev);
int asym_events_drain(asym_event_queue *q, asym_event *out, int max_out);
void asym_events_clear(asym_event_queue *q);

/* Helpers */
void asym_event_make(asym_event *ev, int kind, const char *session_id,
                     uint32_t body_id, const char *species, const char *reason);

#endif
