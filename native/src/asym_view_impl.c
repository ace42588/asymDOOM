/*
 * asym_view_impl.c — Client WASM viewer over doomgeneric (no sim ticks).
 */
#include "asym_view.h"

#include "doomgeneric.h"
#include "doomdef.h"
#include "doomstat.h"
#include "d_main.h"
#include "d_player.h"
#include "g_game.h"
#include "m_argv.h"
#include "m_fixed.h"
#include "m_menu.h"
#include "p_local.h"
#include "p_mobj.h"
#include "p_setup.h"
#include "p_tick.h"
#include "r_main.h"
#include "r_defs.h"
#include "r_state.h"
#include "info.h"
#include "i_video.h"
#include "i_system.h"
#include "v_video.h"
#include "tables.h"
#include "actors.h"
#include "asym_rules.h"
#include "z_zone.h"
#include "s_sound.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define FLOAT_TO_FIXED(f) ((fixed_t)((f) * 65536.0f))

/* View override — defined in r_main.c */
extern boolean asym_view_override_active;
extern fixed_t asym_view_ox, asym_view_oy, asym_view_oz;
extern angle_t asym_view_oangle;
extern boolean asym_view_no_psprites;

extern void doomgeneric_Create(int argc, char **argv);
extern void G_InitNew(skill_t skill, int episode, int map);
extern void R_ExecuteSetViewSize(void);
extern void I_FinishUpdate(void);
extern boolean setsizeneeded;
extern int gametic;
extern int leveltime;

static int g_created = 0;
static int g_map_ep = 0;
static int g_map_num = 0;

static char g_arg0[32];
static char g_arg_iwad[16];
static char g_arg_path[512];
static char g_arg_nosound[16];
static char g_arg_nomusic[16];
static char g_arg_warp[16];
static char g_arg_skill[16];
static char g_arg_scaling[16];
static char g_arg_scale_val[8];
static char *g_argv[16];
static int g_argc = 0;
static int g_pending_scale = 4;
static int g_logged_scale = 0;

static int clamp_fb_scale(int scale)
{
    int max_s = DOOMGENERIC_RESX / SCREENWIDTH;
    if (max_s < 1) max_s = 1;
    if (scale >= 4) return max_s >= 4 ? 4 : max_s;
    if (scale >= 2) return 2;
    return 1;
}

static mobj_t *g_synced_actors[ASYM_VIEW_MAX_ACTORS];
static uint32_t g_synced_actor_ids[ASYM_VIEW_MAX_ACTORS];
static int g_synced_actor_count = 0;
static mobj_t *g_synced_projs[ASYM_VIEW_MAX_PROJECTILES];
static uint32_t g_synced_proj_ids[ASYM_VIEW_MAX_PROJECTILES];
static int g_synced_proj_count = 0;

static angle_t deg_to_angle(float deg)
{
    /* Doom angle: 0 = east, increases counter-clockwise; full circle = 2^32 */
    double norm = fmod((double)deg, 360.0);
    if (norm < 0) norm += 360.0;
    return (angle_t)(norm * (4294967296.0 / 360.0));
}

static sector_t *sector_at(float x, float y)
{
    subsector_t *ss = R_PointInSubsector(FLOAT_TO_FIXED(x), FLOAT_TO_FIXED(y));
    return ss ? ss->sector : NULL;
}

/**
 * Free an mobj immediately. P_RemoveMobj only marks thinkers for later
 * Z_Free via P_RunThinkers — we never tick, so that path leaks the zone.
 */
static void view_free_mobj(mobj_t *mo)
{
    if (!mo) return;
    asym_actors_on_remove(mo);
    P_UnsetThingPosition(mo);
    S_StopSound(mo);
    mo->thinker.next->prev = mo->thinker.prev;
    mo->thinker.prev->next = mo->thinker.next;
    Z_Free(mo);
}

/** Reclaim thinkers left pending by P_RemoveMobj / P_RemoveThinker. */
static void purge_pending_thinkers(void)
{
    thinker_t *th = thinkercap.next;
    while (th != &thinkercap) {
        thinker_t *next = th->next;
        if (th->function.acv == (actionf_v)(-1)) {
            th->next->prev = th->prev;
            th->prev->next = th->next;
            Z_Free(th);
        }
        th = next;
    }
}

static void clear_synced(mobj_t **list, uint32_t *ids, int *count)
{
    int i;
    for (i = 0; i < *count; i++) {
        if (list[i]) {
            view_free_mobj(list[i]);
            list[i] = NULL;
        }
        if (ids) ids[i] = 0;
    }
    *count = 0;
}

/** After P_SetupLevel, drop protocol-owned classes; keep other static
 *  decorations and the local player mobj (required by R_RenderPlayerView). */
static void strip_dynamic_mobjs(void)
{
    thinker_t *th;
    thinker_t *next;

    for (th = thinkercap.next; th != &thinkercap; th = next) {
        mobj_t *mo;
        next = th->next;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (mo->type == MT_PLAYER) continue;
        if ((mo->flags & MF_COUNTKILL)
            || (mo->flags & MF_SHOOTABLE)
            || (mo->flags & MF_SPECIAL)
            || (mo->flags & MF_MISSILE)
            || (mo->flags & MF_CORPSE)
            || asym_rules_is_consumable_deco((int)mo->type)) {
            view_free_mobj(mo);
        }
    }
    purge_pending_thinkers();

    /* Hide local player body from the 3D view (pose comes from override). */
    if (players[consoleplayer].mo) {
        mobj_t *pmo = players[consoleplayer].mo;
        P_UnsetThingPosition(pmo);
        pmo->flags |= MF_NOSECTOR | MF_NOBLOCKMAP;
        pmo->x = 0;
        pmo->y = 0;
    }
}

static void force_fullscreen(void)
{
    screenblocks = 11;
    R_SetViewSize(screenblocks, 0);
    if (setsizeneeded) R_ExecuteSetViewSize();
}

int asym_view_create(const char *iwad_path)
{
    extern boolean singletics;

    if (g_created) return 0;
    if (!iwad_path || !iwad_path[0]) {
        fprintf(stderr, "asym_view_create: iwad_path required\n");
        return -1;
    }

    strncpy(g_arg0, "asym_view", sizeof(g_arg0) - 1);
    strncpy(g_arg_iwad, "-iwad", sizeof(g_arg_iwad) - 1);
    strncpy(g_arg_path, iwad_path, sizeof(g_arg_path) - 1);
    strncpy(g_arg_nosound, "-nosound", sizeof(g_arg_nosound) - 1);
    strncpy(g_arg_nomusic, "-nomusic", sizeof(g_arg_nomusic) - 1);
    strncpy(g_arg_warp, "-warp", sizeof(g_arg_warp) - 1);
    strncpy(g_arg_skill, "3", sizeof(g_arg_skill) - 1);
    strncpy(g_arg_scaling, "-scaling", sizeof(g_arg_scaling) - 1);
    snprintf(g_arg_scale_val, sizeof(g_arg_scale_val), "%d", clamp_fb_scale(g_pending_scale));

    g_argv[0] = g_arg0;
    g_argv[1] = g_arg_iwad;
    g_argv[2] = g_arg_path;
    g_argv[3] = g_arg_nosound;
    g_argv[4] = g_arg_nomusic;
    g_argv[5] = "-skill";
    g_argv[6] = g_arg_skill;
    g_argv[7] = g_arg_warp;
    g_argv[8] = "1";
    g_argv[9] = "1";
    g_argv[10] = g_arg_scaling;
    g_argv[11] = g_arg_scale_val;
    g_argc = 12;

    singletics = true;
    doomgeneric_Create(g_argc, g_argv);
    force_fullscreen();
    strip_dynamic_mobjs();
    g_map_ep = 1;
    g_map_num = 1;
    g_created = 1;
    asym_view_override_active = true;
    g_logged_scale = fb_scaling;
    fprintf(stderr, "[asym_view] ready (fb %dx%d, scale %d → %dx%d)\n",
            DOOMGENERIC_RESX, DOOMGENERIC_RESY, fb_scaling,
            SCREENWIDTH * fb_scaling, SCREENHEIGHT * fb_scaling);
    return 0;
}

int asym_view_load_map(int episode, int map)
{
    if (!g_created) return -1;
    if (episode < 1 || episode > 4 || map < 1 || map > 9) return -1;
    if (episode == g_map_ep && map == g_map_num) return 0;

    clear_synced(g_synced_actors, g_synced_actor_ids, &g_synced_actor_count);
    clear_synced(g_synced_projs, g_synced_proj_ids, &g_synced_proj_count);
    G_InitNew(sk_medium, episode, map);
    force_fullscreen();
    strip_dynamic_mobjs();
    g_map_ep = episode;
    g_map_num = map;
    return 0;
}

void asym_view_set_tick(int tick)
{
    if (tick < 0) tick = 0;
    gametic = tick;
    leveltime = tick;
}

void asym_view_set_view(float x, float y, float z, float angle_deg)
{
    fixed_t fx = FLOAT_TO_FIXED(x);
    fixed_t fy = FLOAT_TO_FIXED(y);
    fixed_t zf = FLOAT_TO_FIXED(z);
    sector_t *sec = sector_at(x, y);

    asym_view_ox = fx;
    asym_view_oy = fy;
    asym_view_oangle = deg_to_angle(angle_deg);

    /*
     * Protocol z is feet. Eye height must use the *viewer* sector floor after
     * movers/doors are applied — client WAD bases diverge at doorways/steps.
     */
    if (sec) {
        fixed_t floor = sec->floorheight;
        fixed_t ceil = sec->ceilingheight;
        fixed_t feet;
        fixed_t eye;
        if (zf >= floor - FRACUNIT && zf <= floor + 24 * FRACUNIT)
            feet = zf;
        else
            feet = floor;
        eye = feet + VIEWHEIGHT;
        if (eye < floor + FRACUNIT)
            eye = floor + FRACUNIT;
        if (ceil > floor + 2 * FRACUNIT && eye > ceil - FRACUNIT)
            eye = ceil - FRACUNIT;
        asym_view_oz = eye;
    } else {
        asym_view_oz = zf + VIEWHEIGHT;
    }
    asym_view_override_active = true;
}

void asym_view_set_hide_psprites(int hide)
{
    asym_view_no_psprites = hide ? true : false;
}

void asym_view_apply_doors(const asym_view_door *doors, int count)
{
    int i;
    if (!doors || count <= 0) return;
    for (i = 0; i < count; i++) {
        sector_t *sec = NULL;
        if (doors[i].x != 0.f || doors[i].y != 0.f)
            sec = sector_at(doors[i].x, doors[i].y);
        if (!sec && doors[i].id >= 0 && doors[i].id < numsectors)
            sec = &sectors[doors[i].id];
        if (!sec) continue;
        sec->ceilingheight = FLOAT_TO_FIXED(doors[i].position);
    }
}

void asym_view_apply_movers(const asym_view_mover *movers, int count)
{
    int i;
    if (!movers || count <= 0) return;
    for (i = 0; i < count; i++) {
        sector_t *sec = NULL;
        if (movers[i].x != 0.f || movers[i].y != 0.f)
            sec = sector_at(movers[i].x, movers[i].y);
        if (!sec && movers[i].id >= 0 && movers[i].id < numsectors)
            sec = &sectors[movers[i].id];
        if (!sec) continue;
        sec->floorheight = FLOAT_TO_FIXED(movers[i].floor);
        sec->ceilingheight = FLOAT_TO_FIXED(movers[i].ceiling);
    }
}

static mobj_t *spawn_view_mobj(int type, float x, float y, float z,
                               float angle_deg, int sprite, int frame)
{
    mobj_t *mo;
    mobjtype_t t;
    if (type < 0 || type >= NUMMOBJTYPES) t = MT_POSSESSED;
    else t = (mobjtype_t)type;

    mo = P_SpawnMobj(FLOAT_TO_FIXED(x), FLOAT_TO_FIXED(y), FLOAT_TO_FIXED(z), t);
    if (!mo) return NULL;
    mo->angle = deg_to_angle(angle_deg);
    /* Do not tick client-synced mobjs (no TryRunTics); override display state. */
    if (sprite >= 0) mo->sprite = (spritenum_t)sprite;
    if (frame >= 0) mo->frame = frame;
    return mo;
}

static void update_view_mobj(mobj_t *mo, float x, float y, float z,
                             float angle_deg, int sprite, int frame)
{
    P_UnsetThingPosition(mo);
    mo->x = FLOAT_TO_FIXED(x);
    mo->y = FLOAT_TO_FIXED(y);
    mo->z = FLOAT_TO_FIXED(z);
    mo->angle = deg_to_angle(angle_deg);
    if (sprite >= 0) mo->sprite = (spritenum_t)sprite;
    if (frame >= 0) mo->frame = frame;
    P_SetThingPosition(mo);
    if (mo->subsector) {
        mo->floorz = mo->subsector->sector->floorheight;
        mo->ceilingz = mo->subsector->sector->ceilingheight;
    }
}

static int find_synced(uint32_t *ids, int count, uint32_t id)
{
    int i;
    for (i = 0; i < count; i++) {
        if (ids[i] == id) return i;
    }
    return -1;
}

void asym_view_sync_actors(const asym_view_actor *actors, int count, uint32_t hide_id)
{
    int i;
    int kept = 0;
    mobj_t *next_mo[ASYM_VIEW_MAX_ACTORS];
    uint32_t next_id[ASYM_VIEW_MAX_ACTORS];
    boolean used[ASYM_VIEW_MAX_ACTORS];

    if (count < 0) count = 0;
    if (count > ASYM_VIEW_MAX_ACTORS) count = ASYM_VIEW_MAX_ACTORS;
    memset(used, 0, sizeof(used));

    for (i = 0; i < count; i++) {
        mobj_t *mo;
        int idx;
        if (!actors) break;
        if (hide_id && actors[i].id == hide_id) continue;

        idx = find_synced(g_synced_actor_ids, g_synced_actor_count, actors[i].id);
        if (idx >= 0 && g_synced_actors[idx]
            && (int)g_synced_actors[idx]->type == actors[i].type) {
            mo = g_synced_actors[idx];
            used[idx] = true;
            update_view_mobj(mo, actors[i].x, actors[i].y, actors[i].z,
                             actors[i].angle, actors[i].sprite, actors[i].frame);
        } else {
            mo = spawn_view_mobj(actors[i].type, actors[i].x, actors[i].y, actors[i].z,
                                 actors[i].angle, actors[i].sprite, actors[i].frame);
            if (!mo) continue;
        }
        if (actors[i].flags) mo->flags = actors[i].flags;
        if (actors[i].health > 0) mo->health = actors[i].health;
        next_mo[kept] = mo;
        next_id[kept] = actors[i].id;
        kept++;
    }

    for (i = 0; i < g_synced_actor_count; i++) {
        if (!used[i] && g_synced_actors[i]) view_free_mobj(g_synced_actors[i]);
    }
    memcpy(g_synced_actors, next_mo, kept * sizeof(mobj_t *));
    memcpy(g_synced_actor_ids, next_id, kept * sizeof(uint32_t));
    g_synced_actor_count = kept;
}

void asym_view_sync_projectiles(const asym_view_projectile *projs, int count)
{
    int i;
    int kept = 0;
    mobj_t *next_mo[ASYM_VIEW_MAX_PROJECTILES];
    uint32_t next_id[ASYM_VIEW_MAX_PROJECTILES];
    boolean used[ASYM_VIEW_MAX_PROJECTILES];

    if (count < 0) count = 0;
    if (count > ASYM_VIEW_MAX_PROJECTILES) count = ASYM_VIEW_MAX_PROJECTILES;
    memset(used, 0, sizeof(used));

    for (i = 0; i < count; i++) {
        mobj_t *mo;
        int idx;
        if (!projs) break;

        idx = find_synced(g_synced_proj_ids, g_synced_proj_count, projs[i].id);
        if (idx >= 0 && g_synced_projs[idx]
            && (int)g_synced_projs[idx]->type == projs[i].type) {
            mo = g_synced_projs[idx];
            used[idx] = true;
            update_view_mobj(mo, projs[i].x, projs[i].y, projs[i].z,
                             projs[i].angle, projs[i].sprite, projs[i].frame);
        } else {
            mo = spawn_view_mobj(projs[i].type, projs[i].x, projs[i].y, projs[i].z,
                                 projs[i].angle, projs[i].sprite, projs[i].frame);
            if (!mo) continue;
        }
        mo->flags |= MF_MISSILE;
        next_mo[kept] = mo;
        next_id[kept] = projs[i].id;
        kept++;
    }

    for (i = 0; i < g_synced_proj_count; i++) {
        if (!used[i] && g_synced_projs[i]) view_free_mobj(g_synced_projs[i]);
    }
    memcpy(g_synced_projs, next_mo, kept * sizeof(mobj_t *));
    memcpy(g_synced_proj_ids, next_id, kept * sizeof(uint32_t));
    g_synced_proj_count = kept;
}

int asym_view_render(int scale)
{
    player_t *pl;
    if (!g_created || !DG_ScreenBuffer) return -1;
    if (gamestate != GS_LEVEL) return -1;

    if (scale > 0) asym_view_set_scaling(scale);

    force_fullscreen();
    pl = &players[displayplayer];
    if (!pl->mo) {
        /* Need a dummy mo for R_SetupFrame fallback fields */
        return -1;
    }

    /* Ensure gametic so D_Display-style gates are happy if reused */
    if (gametic < 1) gametic = 1;

    memset(I_VideoBuffer, 0, SCREENWIDTH * SCREENHEIGHT);
    R_RenderPlayerView(pl);
    I_FinishUpdate();
    return 0;
}

void asym_view_set_scaling(int scale)
{
    scale = clamp_fb_scale(scale);
    g_pending_scale = scale;
    if (!g_created) return;
    if (fb_scaling == scale && g_logged_scale == scale) return;

    fb_scaling = scale;
    if (DG_ScreenBuffer) {
        memset(DG_ScreenBuffer, 0,
               (size_t)DOOMGENERIC_RESX * (size_t)DOOMGENERIC_RESY * sizeof(pixel_t));
    }
    /* Same line I_InitGraphics prints — live proof the 3D blit scale changed. */
    printf("I_InitGraphics: Auto-scaling factor: %d\n", fb_scaling);
    fprintf(stderr, "[asym_view] scaling %d (%dx%d)\n",
            fb_scaling, SCREENWIDTH * fb_scaling, SCREENHEIGHT * fb_scaling);
    fflush(stdout);
    fflush(stderr);
    g_logged_scale = scale;
}

uint8_t *asym_view_framebuffer(void)
{
    return (uint8_t *)DG_ScreenBuffer;
}

int asym_view_width(void)
{
    return SCREENWIDTH * fb_scaling;
}

int asym_view_height(void)
{
    return SCREENHEIGHT * fb_scaling;
}

int asym_view_fb_width(void)
{
    return DOOMGENERIC_RESX;
}

int asym_view_fb_height(void)
{
    return DOOMGENERIC_RESY;
}

void asym_view_destroy(void)
{
    clear_synced(g_synced_actors, g_synced_actor_ids, &g_synced_actor_count);
    clear_synced(g_synced_projs, g_synced_proj_ids, &g_synced_proj_count);
    asym_view_override_active = false;
    /* Engine stays process-global; mark inactive for re-create semantics */
    g_created = 0;
}
