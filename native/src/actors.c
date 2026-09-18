#include "actors.h"
#include "asym_rules.h"
#include "doomdef.h"
#include "doomstat.h"
#include "p_mobj.h"
#include "p_local.h"
#include "r_defs.h"
#include "info.h"

#include <string.h>

#define ASYM_ACTOR_MAP_CAP 1024

static struct mobj_s *g_by_id[ASYM_ACTOR_MAP_CAP];
static uint32_t g_next_id = 1;
static uint32_t g_live = 0;

void asym_actors_reset(void)
{
    memset(g_by_id, 0, sizeof(g_by_id));
    g_next_id = 1;
    g_live = 0;
}

uint32_t asym_actors_next_id(void)
{
    return g_next_id;
}

void asym_actors_on_spawn(struct mobj_s *mo)
{
    uint32_t id;
    if (!mo) return;
    id = g_next_id++;
    if (id >= ASYM_ACTOR_MAP_CAP) {
        /* wrap high ids into open slots — extremely unlikely in E1M1 */
        id = (id % (ASYM_ACTOR_MAP_CAP - 1)) + 1;
    }
    mo->asym_actor_id = id;
    mo->asym_controller = -1;
    g_by_id[id] = mo;
    g_live++;
}

void asym_actors_on_remove(struct mobj_s *mo)
{
    if (!mo || mo->asym_actor_id == 0) return;
    if (mo->asym_actor_id < ASYM_ACTOR_MAP_CAP && g_by_id[mo->asym_actor_id] == mo) {
        g_by_id[mo->asym_actor_id] = NULL;
        if (g_live > 0) g_live--;
    }
    mo->asym_actor_id = 0;
    mo->asym_controller = -1;
}

struct mobj_s *asym_actors_find(uint32_t id)
{
    if (id == 0 || id >= ASYM_ACTOR_MAP_CAP) return NULL;
    return g_by_id[id];
}

uint32_t asym_actors_count(void)
{
    return g_live;
}

int asym_actors_enumerate(struct mobj_s **out, int max_out)
{
    thinker_t *th;
    int n = 0;
    if (!out || max_out <= 0) return 0;

    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (mo->flags & MF_MISSILE) continue;
        /* living + dying/dead + pickups + consumable gore decorations */
        if (mo->type == MT_PLAYER
            || (mo->flags & MF_COUNTKILL)
            || (mo->flags & MF_SHOOTABLE)
            || (mo->flags & MF_CORPSE)
            || (mo->flags & MF_SPECIAL)
            || asym_rules_is_consumable_deco((int)mo->type)) {
            out[n++] = mo;
            if (n >= max_out) break;
        }
    }
    return n;
}
