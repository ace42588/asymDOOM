/*
 * asym_sound.c — Capture S_StartSound into a dedicated queue for thin clients.
 * Gameplay events stay on the main queue so SFX never push them out.
 */
#include "asym_sound.h"
#include "asym_embed.h"
#include "events/events.h"

#include "doomdef.h"
#include "doomtype.h"
#include "m_fixed.h"
#include "p_mobj.h"
#include "sounds.h"

#include <string.h>

#define FIXED_TO_FLOAT(f) ((float)(f) / 65536.0f)

static asym_event_queue g_sound_q;
static int g_sound_q_live = 0;

/* SFX the client reconstructs from doors/plats/movers/projectiles/deaths/pickups. */
static int sound_is_inferred(int sfx_id)
{
    switch (sfx_id) {
    case sfx_doropn:
    case sfx_dorcls:
    case sfx_bdopn:
    case sfx_bdcls:
    case sfx_pstart:
    case sfx_pstop:
    case sfx_stnmov:
    case sfx_firsht:
    case sfx_firxpl:
    case sfx_rlaunc:
    case sfx_plasma:
    case sfx_rxplod:
    case sfx_barexp:
    case sfx_itemup:
    case sfx_wpnup:
    case sfx_getpow:
    case sfx_sgcock:
    case sfx_pldeth:
    case sfx_pdiehi:
    case sfx_podth1:
    case sfx_podth2:
    case sfx_podth3:
    case sfx_bgdth1:
    case sfx_bgdth2:
    case sfx_sgtdth:
    case sfx_cacdth:
    case sfx_skldth:
    case sfx_brsdth:
    case sfx_cybdth:
    case sfx_spidth:
    case sfx_bspdth:
    case sfx_vildth:
    case sfx_kntdth:
    case sfx_pedth:
    case sfx_skedth:
        return 1;
    default:
        return 0;
    }
}

void asym_sound_reset(void)
{
    asym_events_init(&g_sound_q);
    g_sound_q_live = 1;
}

void asym_sound_shutdown(void)
{
    asym_events_clear(&g_sound_q);
    g_sound_q_live = 0;
}

int asym_sound_drain(asym_event *out, int max_out)
{
    if (!g_sound_q_live || !out || max_out <= 0) return 0;
    return asym_events_drain(&g_sound_q, out, max_out);
}

void asym_notify_sound(void *origin_p, int sfx_id)
{
    asym_event ev;
    mobj_t *origin;
    const char *name;

    if (!g_sound_q_live) return;
    if (sfx_id < 1 || sfx_id >= NUMSFX) return;
    if (sound_is_inferred(sfx_id)) return;

    name = S_sfx[sfx_id].name;
    if (!name || !name[0] || strcmp(name, "none") == 0) return;

    memset(&ev, 0, sizeof(ev));
    ev.kind = ASYM_EV_SOUND;
    strncpy(ev.sound, name, sizeof(ev.sound) - 1);

    origin = (mobj_t *)origin_p;
    if (origin) {
        /* Works for mobj_t and degenmobj_t (sector soundorg) — x/y/z share layout. */
        ev.x = FIXED_TO_FLOAT(origin->x);
        ev.y = FIXED_TO_FLOAT(origin->y);
        ev.z = FIXED_TO_FLOAT(origin->z);
        ev.has_origin = 1;
    }

    asym_events_push(&g_sound_q, &ev);
}
