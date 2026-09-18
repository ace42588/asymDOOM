#ifndef ASYM_SOUND_H
#define ASYM_SOUND_H

#include "asym_embed.h"

/* Capture S_StartSound for thin-client wire events (no host playback). */
void asym_notify_sound(void *origin_p, int sfx_id);

/* Bind/clear the dedicated sound queue (called from embed create/destroy). */
void asym_sound_reset(void);
void asym_sound_shutdown(void);

/* Drain pending sound events into out[0..max_out). Returns count. */
int asym_sound_drain(asym_event *out, int max_out);

#endif
