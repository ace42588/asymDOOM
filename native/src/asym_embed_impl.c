/*
 * asym_embed_impl.c — Real embed API over doomgeneric headless.
 */
#include "asym_embed.h"
#include "actors.h"
#include "control.h"
#include "asym_rules.h"
#include "asym_sound.h"
#include "events/events.h"

#include "doomgeneric.h"
#include "doomdef.h"
#include "doomstat.h"
#include "d_main.h"
#include "d_player.h"
#include "g_game.h"
#include "m_argv.h"
#include "p_local.h"
#include "p_mobj.h"
#include "p_spec.h"
#include "info.h"
#include "r_defs.h"
#include "r_state.h"
#include "i_system.h"
#include "d_items.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Host-driven clock: each asym_tick advances 1000/35 ms. */
static uint32_t g_host_ticks_ms = 0;
static int g_engine_ready = 0;

/* Provide stubs expected by doomgeneric_headless / our headless */
int api_get_input_event(int *pressed, unsigned char *key)
{
    (void)pressed;
    (void)key;
    return 0;
}

/* Override weak symbols via our headless file — see doomgeneric_asym.c */

#define FIXED_TO_FLOAT(f) ((float)(f) / 65536.0f)

struct asym_embed {
    asym_config cfg;
    char iwad_buf[512];
    asym_event_queue events;
    asym_rules_state rules;
    int created;
    char *argv_storage[16];
    char arg0[32];
    char arg_iwad[16];
    char arg_path[512];
    char arg_warp[16];
    char arg_skill[16];
    char arg_nomusic[16];
    char arg_nosound[16];
    char arg_nogui[16];
    int argc;
};

/* doomgeneric global init is once-per-process */
static int g_dg_inited = 0;
static asym_embed *g_live_embed = NULL;

/* Front-sidedef textures at last P_SetupLevel (keyed by linedef). */
static short *g_sw_base = NULL;
static int g_sw_nlines = 0;

extern int switchlist[];
extern int numswitches;

static void capture_switch_baseline(void)
{
    int i;
    free(g_sw_base);
    g_sw_base = NULL;
    g_sw_nlines = numlines;
    if (g_sw_nlines <= 0) return;
    g_sw_base = (short *)malloc((size_t)g_sw_nlines * 3 * sizeof(short));
    if (!g_sw_base) {
        g_sw_nlines = 0;
        return;
    }
    for (i = 0; i < g_sw_nlines; i++) {
        int sn = lines[i].sidenum[0];
        short top = 0, mid = 0, bot = 0;
        if (sn >= 0 && sn < numsides) {
            top = sides[sn].toptexture;
            mid = sides[sn].midtexture;
            bot = sides[sn].bottomtexture;
        }
        g_sw_base[i * 3 + 0] = top;
        g_sw_base[i * 3 + 1] = mid;
        g_sw_base[i * 3 + 2] = bot;
    }
}

/* Forward decls from our timing override */
extern void asym_host_set_ticks_ms(uint32_t ms);
extern uint32_t asym_host_get_ticks_ms(void);
extern void asym_host_sleep_noop(uint32_t ms);

static const char *item_name_for(mobjtype_t t)
{
    switch (t) {
    case MT_MISC0: return "armor";
    case MT_MISC1: return "megaarmor";
    case MT_MISC2: return "healthbonus";
    case MT_MISC3: return "armorbonus";
    case MT_MISC4: return "bluecard";
    case MT_MISC5: return "redcard";
    case MT_MISC6: return "yellowcard";
    case MT_MISC7: return "yellowskull";
    case MT_MISC8: return "redskull";
    case MT_MISC9: return "blueskull";
    case MT_MISC10: return "stimpack";
    case MT_MISC11: return "medikit";
    case MT_MISC12: return "soulsphere";
    case MT_INV: return "invulnerability";
    case MT_MISC13: return "berserk";
    case MT_INS: return "invisibility";
    case MT_MISC14: return "radsuit";
    case MT_MISC15: return "automap";
    case MT_MISC16: return "visor";
    case MT_MEGA: return "megasphere";
    case MT_CLIP: return "clip";
    case MT_MISC17: return "clipbox";
    case MT_MISC18: return "rocket";
    case MT_MISC19: return "rocketbox";
    case MT_MISC20: return "cell";
    case MT_MISC21: return "cellpack";
    case MT_MISC22: return "shell";
    case MT_MISC23: return "shellbox";
    case MT_MISC24: return "backpack";
    case MT_MISC25: return "bfg";
    case MT_CHAINGUN: return "chaingun";
    case MT_MISC26: return "chainsaw";
    case MT_MISC27: return "rocketlauncher";
    case MT_MISC28: return "plasmarifle";
    case MT_SHOTGUN: return "shotgun";
    case MT_SUPERSHOTGUN: return "supershotgun";
    case MT_BARREL: return "barrel";
    default: return NULL;
    }
}

static const char *type_name_for(mobjtype_t t)
{
    const char *item = item_name_for(t);
    if (item) return item;
    return asym_rules_species_name((int)t);
}

static void settle_ticks(void)
{
    int i;
    for (i = 0; i < 3; i++) {
        g_host_ticks_ms += 1000 / TICRATE;
        asym_host_set_ticks_ms(g_host_ticks_ms);
        doomgeneric_Tick();
    }
}

asym_embed *asym_create(const asym_config *cfg)
{
    asym_embed *e;
    extern boolean singletics;
    extern void G_InitNew(skill_t skill, int episode, int map);

    if (!cfg || !cfg->iwad_path) {
        fprintf(stderr, "asym_create: iwad_path required\n");
        return NULL;
    }

    /* Reuse process-global engine: re-init map instead of second Create */
    if (g_dg_inited && g_live_embed) {
        e = g_live_embed;
        e->cfg = *cfg;
        strncpy(e->iwad_buf, cfg->iwad_path, sizeof(e->iwad_buf) - 1);
        e->cfg.iwad_path = e->iwad_buf;
        asym_events_init(&e->events);
        asym_sound_reset();
        asym_control_init();
        asym_actors_reset();
        asym_rules_init(&e->rules, cfg->marine_death,
                        cfg->possess_mask ? cfg->possess_mask : ASYM_P_DEFAULT,
                        &e->events);
        G_InitNew((skill_t)cfg->skill, cfg->episode, cfg->map);
        capture_switch_baseline();
        settle_ticks();
        e->created = 1;
        fprintf(stderr, "[asym] re-init E%iM%i (actors=%u)\n",
                cfg->episode, cfg->map, (unsigned)asym_actors_count());
        return e;
    }

    e = calloc(1, sizeof(*e));
    if (!e) return NULL;
    e->cfg = *cfg;
    strncpy(e->iwad_buf, cfg->iwad_path, sizeof(e->iwad_buf) - 1);
    e->cfg.iwad_path = e->iwad_buf;

    asym_events_init(&e->events);
    asym_sound_reset();
    asym_control_init();
    asym_actors_reset();
    asym_rules_init(&e->rules, cfg->marine_death,
                    cfg->possess_mask ? cfg->possess_mask : ASYM_P_DEFAULT,
                    &e->events);

    strncpy(e->arg0, "asymdoom", sizeof(e->arg0) - 1);
    strncpy(e->arg_iwad, "-iwad", sizeof(e->arg_iwad) - 1);
    strncpy(e->arg_path, e->iwad_buf, sizeof(e->arg_path) - 1);
    strncpy(e->arg_nomusic, "-nomusic", sizeof(e->arg_nomusic) - 1);
    strncpy(e->arg_nosound, "-nosfx", sizeof(e->arg_nosound) - 1);
    strncpy(e->arg_nogui, "-nogui", sizeof(e->arg_nogui) - 1);
    e->argv_storage[0] = e->arg0;
    e->argv_storage[1] = e->arg_iwad;
    e->argv_storage[2] = e->arg_path;
    e->argv_storage[3] = e->arg_nomusic;
    e->argv_storage[4] = e->arg_nosound;
    e->argv_storage[5] = e->arg_nogui;
    e->argv_storage[6] = NULL;
    e->argc = 6;

    g_host_ticks_ms = 0;
    asym_host_set_ticks_ms(0);

    singletics = true;

    fprintf(stderr, "[asym] creating doomgeneric with iwad %s\n", e->iwad_buf);
    doomgeneric_Create(e->argc, e->argv_storage);

    g_engine_ready = 1;
    g_dg_inited = 1;
    g_live_embed = e;

    G_InitNew((skill_t)cfg->skill, cfg->episode, cfg->map);
    capture_switch_baseline();
    settle_ticks();

    e->created = 1;
    fprintf(stderr, "[asym] E%iM%i ready (actors=%u)\n",
            cfg->episode, cfg->map, (unsigned)asym_actors_count());
    return e;
}

void asym_destroy(asym_embed *e)
{
    if (!e) return;
    /* Keep process-global doomgeneric alive; just clear session state. */
    asym_control_init();
    asym_events_clear(&e->events);
    asym_sound_shutdown();
    e->created = 0;
    g_asym_rules = NULL;
}

void asym_tick(asym_embed *e)
{
    if (!e || !e->created) return;

    /* Handle pending round reload */
    if (e->rules.need_round_reload) {
        e->rules.need_round_reload = 0;
        G_InitNew((skill_t)e->cfg.skill, e->cfg.episode, e->cfg.map);
        capture_switch_baseline();
    }

    g_host_ticks_ms += 1000 / TICRATE;
    asym_host_set_ticks_ms(g_host_ticks_ms);
    doomgeneric_Tick();
}

int asym_register_session(asym_embed *e, const char *session_id)
{
    int slot;
    asym_controller *c;
    if (!e) return -1;
    slot = asym_control_alloc(session_id);
    if (slot < 0) return -1;
    c = asym_control_by_slot(slot);

    /* First session → marine; others → possess demon */
    if (e->rules.marine_slot < 0) {
        e->rules.marine_slot = slot;
        c->role = 1;
        if (players[consoleplayer].mo) {
            c->body_id = players[consoleplayer].mo->asym_actor_id;
        }
    } else {
        asym_rules_possess_auto(slot, 1);
    }
    return slot;
}

void asym_unregister_session(asym_embed *e, const char *session_id)
{
    int slot;
    if (!e) return;
    slot = asym_control_slot_of(session_id);
    if (slot < 0) return;
    if (e->rules.marine_slot == slot) e->rules.marine_slot = -1;
    asym_rules_release(slot);
    asym_control_free(slot);
}

void asym_submit_input(asym_embed *e, const char *session_id, const asym_input *in)
{
    asym_controller *c;
    if (!e || !in) return;
    c = asym_control_by_session(session_id);
    if (!c) return;
    c->latch = *in;
}

int asym_possess(asym_embed *e, const char *session_id, uint32_t body_id)
{
    int slot;
    if (!e) return 0;
    slot = asym_control_slot_of(session_id);
    if (slot < 0) return 0;
    /* Don't steal marine */
    if (asym_control_by_slot(slot)->role == 1) return 0;
    return asym_rules_possess(slot, body_id, 1);
}

void asym_release(asym_embed *e, const char *session_id)
{
    int slot;
    if (!e) return;
    slot = asym_control_slot_of(session_id);
    if (slot < 0) return;
    if (e->rules.marine_slot == slot) {
        /* marine leave: just unregister handled by caller */
        return;
    }
    asym_rules_release(slot);
}

static int door_state_code(vldoor_e type, int direction)
{
    /* Rough mapping */
    (void)type;
    if (direction > 0) return 2; /* opening */
    if (direction < 0) return 3; /* closing */
    return 1;
}

void asym_get_snapshot(asym_embed *e, asym_snapshot *out)
{
    mobj_t *list[ASYM_MAX_ACTORS];
    int n, i;
    thinker_t *th;
    int di;

    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (!e) return;

    out->tick = gametic;
    snprintf(out->map_name, sizeof(out->map_name), "E%dM%d", gameepisode, gamemap);
    out->map_ready = e->rules.map_ready;
    out->pending_reload = e->rules.want_round_reload;

    n = asym_actors_enumerate(list, ASYM_MAX_ACTORS);
    for (i = 0; i < n; i++) {
        mobj_t *mo = list[i];
        asym_actor *a = &out->actors[out->actor_count++];
        a->id = mo->asym_actor_id;
        if (mo->type == MT_PLAYER) a->kind = 0;
        else if ((mo->flags & MF_SPECIAL) || asym_rules_is_consumable_deco((int)mo->type))
            a->kind = 2; /* pickup / gore prop */
        else a->kind = 1;
        a->type = (int)mo->type;
        strncpy(a->type_name,
                mo->type == MT_PLAYER ? "marine" : type_name_for(mo->type),
                sizeof(a->type_name) - 1);
        a->x = FIXED_TO_FLOAT(mo->x);
        a->y = FIXED_TO_FLOAT(mo->y);
        a->z = FIXED_TO_FLOAT(mo->z);
        a->angle = (float)mo->angle * (360.0f / 4294967296.0f);
        a->momx = FIXED_TO_FLOAT(mo->momx);
        a->momy = FIXED_TO_FLOAT(mo->momy);
        a->momz = FIXED_TO_FLOAT(mo->momz);
        a->health = mo->health;
        a->max_health = mo->info ? mo->info->spawnhealth : mo->health;
        a->sprite = (int)mo->sprite;
        a->frame = mo->frame;
        a->flags = mo->flags;
        a->controller = mo->asym_controller;
        if (mo->asym_controller >= 0) {
            asym_controller *c = asym_control_by_slot(mo->asym_controller);
            if (c) strncpy(a->controller_session_id, c->session_id, ASYM_SESSION_ID_LEN - 1);
        }
        /* marine session binding */
        if (mo->type == MT_PLAYER && e->rules.marine_slot >= 0) {
            asym_controller *c = asym_control_by_slot(e->rules.marine_slot);
            a->controller = e->rules.marine_slot;
            if (c) strncpy(a->controller_session_id, c->session_id, ASYM_SESSION_ID_LEN - 1);
        }
    }

    /* projectiles + short-lived combat FX (puff / blood) */
    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        asym_projectile *p;
        int is_fx;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        is_fx = (mo->type == MT_PUFF || mo->type == MT_BLOOD);
        if (!(mo->flags & MF_MISSILE) && !is_fx) continue;
        if (out->projectile_count >= ASYM_MAX_PROJECTILES) break;
        p = &out->projectiles[out->projectile_count++];
        p->id = mo->asym_actor_id;
        p->type = (int)mo->type;
        p->x = FIXED_TO_FLOAT(mo->x);
        p->y = FIXED_TO_FLOAT(mo->y);
        p->z = FIXED_TO_FLOAT(mo->z);
        p->angle = (float)mo->angle * (360.0f / 4294967296.0f);
        p->momx = FIXED_TO_FLOAT(mo->momx);
        p->momy = FIXED_TO_FLOAT(mo->momy);
        p->momz = FIXED_TO_FLOAT(mo->momz);
        p->sprite = (int)mo->sprite;
        p->frame = mo->frame;
    }

    /* doors from ceiling thinkers */
    di = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        vldoor_t *door;
        asym_door *d;
        if (th->function.acp1 != (actionf_p1)T_VerticalDoor) continue;
        door = (vldoor_t *)th;
        if (out->door_count >= ASYM_MAX_DOORS) break;
        d = &out->doors[out->door_count++];
        /* Stable id = sector index so deltas survive thinker churn. */
        d->id = door->sector ? (int)(door->sector - sectors) : di;
        di++;
        d->state = door_state_code(door->type, door->direction);
        d->position = door->sector ? FIXED_TO_FLOAT(door->sector->ceilingheight) : 0.f;
        if (door->sector) {
            d->x = FIXED_TO_FLOAT(door->sector->soundorg.x);
            d->y = FIXED_TO_FLOAT(door->sector->soundorg.y);
            d->z = FIXED_TO_FLOAT(door->sector->soundorg.z);
        }
    }

    /* plats / floors / ceilings → movers (floor + ceiling heights) */
    {
        int mi = 0;
        for (th = thinkercap.next; th != &thinkercap; th = th->next) {
            asym_mover *m;
            sector_t *sec = NULL;
            int kind = -1;
            int state = 0;
            if (th->function.acp1 == (actionf_p1)T_PlatRaise) {
                plat_t *plat = (plat_t *)th;
                sec = plat->sector;
                kind = 0;
                if (plat->status == up) state = 1;
                else if (plat->status == down) state = 2;
                else state = 0;
            } else if (th->function.acp1 == (actionf_p1)T_MoveFloor) {
                floormove_t *floor = (floormove_t *)th;
                sec = floor->sector;
                kind = 1;
                state = floor->direction > 0 ? 1 : (floor->direction < 0 ? 2 : 0);
            } else if (th->function.acp1 == (actionf_p1)T_MoveCeiling) {
                ceiling_t *ceil = (ceiling_t *)th;
                sec = ceil->sector;
                kind = 2;
                state = ceil->direction > 0 ? 1 : (ceil->direction < 0 ? 2 : 0);
            } else {
                continue;
            }
            if (!sec || out->mover_count >= ASYM_MAX_MOVERS) continue;
            m = &out->movers[out->mover_count++];
            m->id = (int)(sec - sectors);
            (void)mi;
            mi++;
            m->kind = kind;
            m->state = state;
            m->floor = FIXED_TO_FLOAT(sec->floorheight);
            m->ceiling = FIXED_TO_FLOAT(sec->ceilingheight);
            m->x = FIXED_TO_FLOAT(sec->soundorg.x);
            m->y = FIXED_TO_FLOAT(sec->soundorg.y);
            m->z = FIXED_TO_FLOAT(sec->soundorg.z);
        }
    }

    /* marine vitals */
    {
        player_t *pl = &players[consoleplayer];
        int i;
        out->marine.health = pl->health;
        out->marine.armor = pl->armorpoints;
        out->marine.weapon = (int)pl->readyweapon;
        if (pl->readyweapon == wp_pistol || pl->readyweapon == wp_chaingun)
            out->marine.ammo = pl->ammo[am_clip];
        else if (pl->readyweapon == wp_shotgun || pl->readyweapon == wp_supershotgun)
            out->marine.ammo = pl->ammo[am_shell];
        else if (pl->readyweapon == wp_missile)
            out->marine.ammo = pl->ammo[am_misl];
        else if (pl->readyweapon == wp_plasma || pl->readyweapon == wp_bfg)
            out->marine.ammo = pl->ammo[am_cell];
        else
            out->marine.ammo = 0;
        for (i = 0; i < 4; i++) {
            out->marine.ammo_counts[i] = pl->ammo[i];
            out->marine.max_ammo[i] = pl->maxammo[i];
        }
        out->marine.weapons = 0;
        for (i = 0; i < NUMWEAPONS; i++) {
            if (pl->weaponowned[i])
                out->marine.weapons |= (1 << i);
        }
        out->marine.cards = 0;
        for (i = 0; i < NUMCARDS; i++) {
            if (pl->cards[i])
                out->marine.cards |= (1 << i);
        }
        out->marine.damagecount = pl->damagecount;
    }

    /* Wall switches: linedefs whose front textures left the IWAD baseline. */
    if (g_sw_nlines != numlines) capture_switch_baseline();
    if (g_sw_base) {
        int i;
        for (i = 0; i < numlines && out->switch_count < ASYM_MAX_SWITCHES; i++) {
            int sn = lines[i].sidenum[0];
            short top = 0, mid = 0, bot = 0;
            if (sn >= 0 && sn < numsides) {
                top = sides[sn].toptexture;
                mid = sides[sn].midtexture;
                bot = sides[sn].bottomtexture;
            }
            if (i >= g_sw_nlines) continue;
            if (top == g_sw_base[i * 3 + 0]
                && mid == g_sw_base[i * 3 + 1]
                && bot == g_sw_base[i * 3 + 2]) {
                continue;
            }
            {
                asym_switch *s = &out->switches[out->switch_count++];
                s->id = i;
                s->top = top;
                s->mid = mid;
                s->bot = bot;
            }
        }
    }
}

int asym_events_pull(asym_embed *e, asym_event *out, int max_out)
{
    int n;
    if (!e || !out || max_out <= 0) return 0;
    n = asym_events_drain(&e->events, out, max_out);
    if (n < max_out) {
        n += asym_sound_drain(out + n, max_out - n);
    }
    return n;
}

int asym_role(asym_embed *e, const char *session_id)
{
    asym_controller *c;
    if (!e) return 0;
    c = asym_control_by_session(session_id);
    return c ? c->role : 0;
}

uint32_t asym_body(asym_embed *e, const char *session_id)
{
    asym_controller *c;
    if (!e) return 0;
    c = asym_control_by_session(session_id);
    if (!c) return 0;
    if (c->role == 1 && players[consoleplayer].mo)
        return players[consoleplayer].mo->asym_actor_id;
    return c->body_id;
}

int asym_points(asym_embed *e, const char *session_id)
{
    asym_controller *c;
    if (!e) return 0;
    c = asym_control_by_session(session_id);
    return c ? c->points : 0;
}

void asym_mods_get(asym_embed *e, const char *session_id, asym_mods *out)
{
    asym_controller *c;
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (!e) return;
    c = asym_control_by_session(session_id);
    if (c) *out = c->mods;
}

int asym_get_tick(asym_embed *e)
{
    (void)e;
    return gametic;
}

void asym_debug_sim_get(asym_embed *e, asym_debug_sim *out)
{
    thinker_t *th;
    player_t *pl;
    extern boolean menuactive;
    extern gamestate_t gamestate;
    extern boolean paused;

    if (!out) return;
    memset(out, 0, sizeof(*out));

    out->gametic = gametic;
    out->leveltime = leveltime;
    out->gamestate = (int)gamestate;
    out->paused = paused ? 1 : 0;
    out->menuactive = menuactive ? 1 : 0;
    out->created = (e && e->created) ? 1 : 0;
    out->rules_live = g_asym_rules ? 1 : 0;
    out->playeringame0 = playeringame[0] ? 1 : 0;
    pl = &players[consoleplayer];
    out->player_health = pl->health;
    out->player_mo_health = pl->mo ? pl->mo->health : 0;

    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        out->thinker_total++;
        if (th->function.acv == (actionf_v)(-1)) {
            out->thinker_pending_free++;
            continue;
        }
        if (th->function.acp1 == (actionf_p1)T_VerticalDoor) {
            out->thinker_door++;
            continue;
        }
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        out->thinker_mobj++;
        mo = (mobj_t *)th;
        if (mo->asym_controller < 0) out->controller_neg1++;
        else {
            out->controller_ge0++;
            if (!asym_control_by_slot(mo->asym_controller))
                out->controller_orphan++;
        }
        if ((mo->flags & MF_COUNTKILL) && mo->health > 0 && !(mo->flags & MF_CORPSE)) {
            out->living_countkill++;
            if (asym_rules_is_possessable(mo)) out->possessable++;
            if (out->sample_count < ASYM_DEBUG_SAMPLE) {
                asym_debug_sample *s = &out->samples[out->sample_count++];
                s->id = mo->asym_actor_id;
                s->type = (int)mo->type;
                s->health = mo->health;
                s->controller = mo->asym_controller;
                s->tics = mo->tics;
            }
        }
    }
}

size_t asym_sizeof_actor(void) { return sizeof(asym_actor); }
size_t asym_sizeof_snapshot(void) { return sizeof(asym_snapshot); }
size_t asym_sizeof_event(void) { return sizeof(asym_event); }
size_t asym_sizeof_debug_sim(void) { return sizeof(asym_debug_sim); }

void asym_test_start_sound(int sfx_id)
{
    extern void S_StartSound(void *origin, int sound_id);
    S_StartSound(NULL, sfx_id);
}

static int is_switch_tex(int tex)
{
    int i;
    for (i = 0; i < numswitches * 2; i++) {
        if (switchlist[i] == tex) return 1;
    }
    return 0;
}

int asym_test_flip_first_switch(int use_again)
{
    int i;
    for (i = 0; i < numlines; i++) {
        int sn = lines[i].sidenum[0];
        if (sn < 0 || sn >= numsides) continue;
        if (is_switch_tex(sides[sn].toptexture)
            || is_switch_tex(sides[sn].midtexture)
            || is_switch_tex(sides[sn].bottomtexture)) {
            P_ChangeSwitchTexture(&lines[i], use_again ? 1 : 0);
            return i;
        }
    }
    return -1;
}
