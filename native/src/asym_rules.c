#include "asym_rules.h"
#include "actors.h"

#include "doomdef.h"
#include "doomstat.h"
#include "p_local.h"
#include "p_mobj.h"
#include "info.h"
#include "sounds.h"
#include "s_sound.h"
#include "g_game.h"
#include "m_random.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* from p_enemy.c */
boolean P_CheckMeleeRange(mobj_t *actor);
extern fixed_t xspeed[8];
extern fixed_t yspeed[8];

#define ASYM_PROBE_STEP (16 * FRACUNIT)
#define ASYM_PROBE_MAX 64
/* Sentinel: >= 0 so P_MobjSlides treats the probe as possessed. */
#define ASYM_PROBE_CTRL ASYM_MAX_SESSIONS

asym_rules_state *g_asym_rules = NULL;

/* ---- upgrade ladders (level 0 = baseline; cost is to reach that level) ---- */

static const asym_upgrade_level asym_health_upgrades[] = {
    {0, 100},
    {25, 125},
    {50, 150},
    {50, 175},
    {50, 200},
    {50, 250},
};

static const asym_upgrade_level asym_speed_upgrades[] = {
    {0, 100},
    {25, 125},
    {50, 140},
    {50, 160},
    {75, 200},
};

static const asym_upgrade_level asym_damage_upgrades[] = {
    {0, 100},
    {25, 115},
    {25, 125},
    {50, 150},
    {50, 175},
    {50, 200},
};

static const asym_upgrade_level asym_rate_upgrades[] = {
    {0, 100},
    {25, 120},
    {25, 140},
    {50, 160},
    {50, 180},
    {50, 200},
};

static const asym_upgrade_table asym_upgrades[ASYM_UPGRADE_COUNT] = {
    {asym_health_upgrades, (int)(sizeof(asym_health_upgrades) / sizeof(asym_health_upgrades[0]))},
    {asym_speed_upgrades,  (int)(sizeof(asym_speed_upgrades) / sizeof(asym_speed_upgrades[0]))},
    {asym_damage_upgrades, (int)(sizeof(asym_damage_upgrades) / sizeof(asym_damage_upgrades[0]))},
    {asym_rate_upgrades,   (int)(sizeof(asym_rate_upgrades) / sizeof(asym_rate_upgrades[0]))},
};

static int upgrade_scalar(asym_upgrade_kind kind, int lvl)
{
    const asym_upgrade_table *t;
    if (kind < 0 || kind >= ASYM_UPGRADE_COUNT) return 100;
    t = &asym_upgrades[kind];
    if (lvl < 0) lvl = 0;
    if (lvl >= t->count) lvl = t->count - 1;
    return t->levels[lvl].scalar;
}

typedef struct {
    mobjtype_t type;
    const char *name;
    int mask_bit;
    int attack_cooldown;
} asym_species_t;

static const asym_species_t species_table[] = {
    {MT_POSSESSED, "zombieman",  (1 << 0), 28},
    {MT_SHOTGUY,   "shotgunner", (1 << 1), 42},
    {MT_TROOP,     "imp",        (1 << 2), 30},
    {MT_SERGEANT,  "demon",      (1 << 3), 22},
    {MT_SHADOWS,   "spectre",    (1 << 4), 22},
    {MT_SKULL,     "lostsoul",   (1 << 5), 40},
    {MT_HEAD,      "cacodemon",  (1 << 6), 38},
    {MT_BRUISER,   "baron",      (1 << 7), 48},
};

static const asym_species_t *species_for(mobjtype_t t)
{
    size_t i;
    for (i = 0; i < sizeof(species_table) / sizeof(species_table[0]); i++) {
        if (species_table[i].type == t) return &species_table[i];
    }
    return NULL;
}

static void push_ev(int kind, const char *sid, uint32_t body, const char *sp, const char *reason)
{
    asym_event ev;
    if (!g_asym_rules || !g_asym_rules->events) return;
    asym_event_make(&ev, kind, sid, body, sp, reason);
    asym_events_push(g_asym_rules->events, &ev);
}

void asym_rules_init(asym_rules_state *st, int marine_death, int possess_mask, asym_event_queue *eq)
{
    memset(st, 0, sizeof(*st));
    st->marine_death = marine_death;
    st->possess_mask = possess_mask ? possess_mask : ASYM_P_DEFAULT;
    st->marine_slot = -1;
    st->pending_marine_slot = -1;
    st->events = eq;
    g_asym_rules = st;
}

const char *asym_rules_species_name(int mobjtype)
{
    const asym_species_t *s = species_for((mobjtype_t)mobjtype);
    return s ? s->name : "unknown";
}

/* Heal stale controller slots left after session teardown / mixed builds.
   Returns 1 if a living session currently owns this mobj. */
int asym_rules_controller_active(mobj_t *mo)
{
    asym_controller *c;
    if (!mo || mo->asym_controller < 0) return 0;
    c = asym_control_by_slot(mo->asym_controller);
    if (!c) {
        mo->asym_controller = -1;
        return 0;
    }
    return 1;
}

int asym_rules_is_possessable(mobj_t *mo)
{
    const asym_species_t *s;
    if (!mo || !g_asym_rules) return 0;
    if (mo->health <= 0) return 0;
    if (mo->flags & MF_CORPSE) return 0;
    if (mo->type == MT_PLAYER) return 0;
    if (asym_rules_controller_active(mo)) return 0;
    s = species_for(mo->type);
    if (!s) return 0;
    return (g_asym_rules->possess_mask & s->mask_bit) != 0;
}

int asym_rules_move_scale(asym_controller *c, mobj_t *mo)
{
    int speed = (mo && mo->info && mo->info->speed > 0) ? mo->info->speed : 8;
    int base = ASYM_THRUST_BASE * speed / 8;
    int lvl = c ? c->mods.speed : 0;
    return base * upgrade_scalar(ASYM_UPGRADE_SPEED, lvl) / 100;
}

int asym_rules_attack_cooldown(asym_controller *c, mobj_t *mo)
{
    const asym_species_t *s = species_for(mo->type);
    int base = s ? s->attack_cooldown : 35;
    int lvl = c ? c->mods.rate : 0;
    int rate = upgrade_scalar(ASYM_UPGRADE_RATE, lvl);
    if (rate < 1) rate = 1;
    return base * 100 / rate;
}

mobj_t *asym_rules_melee_target(mobj_t *mo)
{
    /* Simple: if marine in melee range, return marine mo */
    player_t *pl = &players[consoleplayer];
    if (!pl->mo || pl->mo->health <= 0) return NULL;
    if (P_CheckMeleeRange(mo)) {
        /* CheckMeleeRange uses actor->target — temporarily set */
        mobj_t *old = mo->target;
        int ok;
        mo->target = pl->mo;
        ok = P_CheckMeleeRange(mo);
        mo->target = old;
        if (ok) return pl->mo;
    }
    return NULL;
}

/* Dry-run stand check matching P_TryMove height rules (no move, no specials). */
static int probe_can_stand(mobj_t *mo, fixed_t x, fixed_t y)
{
    if (!P_CheckPosition(mo, x, y))
        return 0;
    if (mo->flags & MF_NOCLIP)
        return 1;
    if (tmceilingz - tmfloorz < mo->height)
        return 0;
    if (!(mo->flags & MF_TELEPORT) && tmceilingz - mo->z < mo->height)
        return 0;
    if (!(mo->flags & MF_TELEPORT) && tmfloorz - mo->z > 24 * FRACUNIT)
        return 0;
    /* Possessed players may walk off dropoffs — no tmdropoffz reject. */
    return 1;
}

static int probe_visited(fixed_t *vx, fixed_t *vy, int n, fixed_t x, fixed_t y)
{
    int i;
    fixed_t half = ASYM_PROBE_STEP / 2;
    for (i = 0; i < n; i++) {
        if (abs(vx[i] - x) < half && abs(vy[i] - y) < half)
            return 1;
    }
    return 0;
}

static int far_from_spawn(fixed_t x, fixed_t y, fixed_t spawn_x, fixed_t spawn_y)
{
    int dx = (x - spawn_x) >> FRACBITS;
    int dy = (y - spawn_y) >> FRACBITS;
    return dx * dx + dy * dy
        >= ASYM_SPAWN_ESCAPE_MAPUNITS * ASYM_SPAWN_ESCAPE_MAPUNITS;
}

/* True if a possessed player could walk >= ASYM_SPAWN_ESCAPE from spawn. */
static int can_escape_spawn(mobj_t *mo)
{
    fixed_t vx[ASYM_PROBE_MAX];
    fixed_t vy[ASYM_PROBE_MAX];
    int qh, qt, i;
    int old_ctrl;
    int old_probe;
    fixed_t spawn_x, spawn_y;
    int ok = 0;

    if (!mo) return 0;

    spawn_x = mo->spawnpoint.x << FRACBITS;
    spawn_y = mo->spawnpoint.y << FRACBITS;
    if (far_from_spawn(mo->x, mo->y, spawn_x, spawn_y))
        return 1;

    old_ctrl = mo->asym_controller;
    mo->asym_controller = ASYM_PROBE_CTRL;
    old_probe = asym_spawn_probe;
    asym_spawn_probe = 1;

    vx[0] = mo->x;
    vy[0] = mo->y;
    qh = 0;
    qt = 1;

    while (qh < qt) {
        fixed_t cx = vx[qh];
        fixed_t cy = vy[qh];
        qh++;

        for (i = 0; i < 8; i++) {
            fixed_t nx = cx + FixedMul(ASYM_PROBE_STEP, xspeed[i]);
            fixed_t ny = cy + FixedMul(ASYM_PROBE_STEP, yspeed[i]);

            if (probe_visited(vx, vy, qt, nx, ny))
                continue;
            if (!probe_can_stand(mo, nx, ny))
                continue;

            if (far_from_spawn(nx, ny, spawn_x, spawn_y)) {
                ok = 1;
                goto done;
            }
            if (qt >= ASYM_PROBE_MAX)
                continue;
            vx[qt] = nx;
            vy[qt] = ny;
            qt++;
        }
    }

done:
    asym_spawn_probe = old_probe;
    mo->asym_controller = old_ctrl;
    return ok;
}

/* Next (or wrap) possessable body by actor id; mobile_only skips spawn-trapped. */
static mobj_t *find_body_after(uint32_t after_id, int mobile_only)
{
    thinker_t *th;
    mobj_t *best = NULL;
    mobj_t *wrap = NULL;

    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (!asym_rules_is_possessable(mo)) continue;
        if (mobile_only && !can_escape_spawn(mo)) continue;
        if (mo->asym_actor_id > after_id) {
            if (!best || mo->asym_actor_id < best->asym_actor_id) best = mo;
        }
        if (!wrap || mo->asym_actor_id < wrap->asym_actor_id) wrap = mo;
    }
    return best ? best : wrap;
}

/* Uniform pick among free possessable bodies (optionally mobile-only). */
static mobj_t *pick_random_body(int mobile_only)
{
    thinker_t *th;
    int count = 0;
    int pick;
    int i;

    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (!asym_rules_is_possessable(mo)) continue;
        if (mobile_only && !can_escape_spawn(mo)) continue;
        count++;
    }
    if (count <= 0) return NULL;

    pick = M_Random() % count;
    i = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (!asym_rules_is_possessable(mo)) continue;
        if (mobile_only && !can_escape_spawn(mo)) continue;
        if (i == pick) return mo;
        i++;
    }
    return NULL;
}

static mobj_t *find_body(void)
{
    mobj_t *body = pick_random_body(1);
    if (body) return body;
    /* All free bodies trapped — still assign something. */
    return pick_random_body(0);
}

int asym_rules_possess(int slot, uint32_t body_id, int refill)
{
    asym_controller *c = asym_control_by_slot(slot);
    mobj_t *body;
    if (!c) return 0;

    if (body_id == 0) {
        body = find_body();
    } else {
        body = asym_actors_find(body_id);
        if (!body || !asym_rules_is_possessable(body)) return 0;
    }
    if (!body) {
        c->role = 3;
        c->spectating = 1;
        c->body_id = 0;
        push_ev(ASYM_EV_SPECTATE, c->session_id, 0, NULL, "none");
        return 0;
    }

    /* release prior */
    if (c->body_id && c->body_id != body->asym_actor_id) {
        mobj_t *old = asym_actors_find(c->body_id);
        if (old && old->asym_controller == slot) {
            old->asym_controller = -1;
        }
    }

    body->asym_controller = slot;
    body->target = NULL;
    body->flags &= ~MF_AMBUSH;

    if (refill) {
        body->health = body->info->spawnhealth
            * upgrade_scalar(ASYM_UPGRADE_HEALTH, c->mods.health) / 100;
    }

    /* Leave idle look state so the body is ready for player control */
    if (body->info->seestate != S_NULL) {
        P_SetMobjState(body, body->info->seestate);
    }

    c->body_id = body->asym_actor_id;
    c->role = 2;
    c->spectating = 0;
    c->cooldown = 0;
    c->hoptics = 0;

    if (body->info->seesound) S_StartSound(body, body->info->seesound);

    push_ev(ASYM_EV_POSSESS, c->session_id, c->body_id,
            asym_rules_species_name(body->type), refill ? "refill" : "hop");
    return 1;
}

int asym_rules_possess_auto(int slot, int refill)
{
    return asym_rules_possess(slot, 0, refill);
}

void asym_rules_release(int slot)
{
    asym_controller *c = asym_control_by_slot(slot);
    mobj_t *mo;
    if (!c) return;
    if (c->body_id) {
        mo = asym_actors_find(c->body_id);
        if (mo && mo->asym_controller == slot) {
            mo->asym_controller = -1;
            if (players[consoleplayer].mo) mo->target = players[consoleplayer].mo;
        }
        push_ev(ASYM_EV_RELEASE, c->session_id, c->body_id, NULL, "release");
    }
    c->body_id = 0;
    if (c->role == 2) c->role = 3;
    c->spectating = 1;
}

void asym_rules_voluntary_hop(int slot)
{
    asym_controller *c = asym_control_by_slot(slot);
    mobj_t *old;
    mobj_t *next;
    uint32_t after;
    if (!c || c->role != 2) return;
    if (gamestate != GS_LEVEL) return;
    old = asym_actors_find(c->body_id);
    if (!old || old->health <= 0) return;

    if (c->hopcool > 0) {
        push_ev(ASYM_EV_HOPFAIL, c->session_id, c->body_id, NULL, "cool");
        return;
    }

    after = old->asym_actor_id;
    /* Cycle by id among mobile free bodies; fall back to any free if none mobile.
       Our body is still claimed, so possessable skips it via controller check. */
    next = find_body_after(after, 1);
    if (!next)
        next = find_body_after(after, 0);
    if (!next) {
        push_ev(ASYM_EV_HOPFAIL, c->session_id, c->body_id, NULL, "none");
        return;
    }

    old->asym_controller = -1;
    if (players[consoleplayer].mo) old->target = players[consoleplayer].mo;
    c->body_id = 0;

    if (!asym_rules_possess(slot, next->asym_actor_id, 0)) {
        c->hoptics = 1;
        return;
    }
    c->hopcool = 2 * TICRATE;
    push_ev(ASYM_EV_HOP, c->session_id, c->body_id,
            asym_rules_species_name(next->type), "voluntary");
}

void asym_rules_on_demon_death(int slot)
{
    asym_controller *c = asym_control_by_slot(slot);
    if (!c) return;
    if (c->body_id) {
        mobj_t *mo = asym_actors_find(c->body_id);
        if (mo && mo->asym_controller == slot) mo->asym_controller = -1;
    }
    c->body_id = 0;
    c->hoptics = TICRATE; /* possess next after 1s */
}

void asym_rules_on_marine_death(int killer_slot)
{
    if (!g_asym_rules) return;
    push_ev(ASYM_EV_MARINE_KILL, NULL, 0, NULL, "marine");

    switch (g_asym_rules->marine_death) {
    case 1: /* respawn_as_killer */
        g_asym_rules->pending_marine_slot =
            killer_slot >= 0 ? killer_slot : g_asym_rules->marine_slot;
        g_asym_rules->want_round_reload = 1;
        g_asym_rules->win_countdown = 2 * TICRATE;
        push_ev(ASYM_EV_ROUND_RELOAD, NULL, 0, NULL, "countdown");
        break;
    case 2: /* marine_respawn */
        g_asym_rules->pending_marine_slot = g_asym_rules->marine_slot;
        g_asym_rules->want_round_reload = 1;
        g_asym_rules->win_countdown = 2 * TICRATE;
        push_ev(ASYM_EV_ROUND_RELOAD, NULL, 0, NULL, "countdown");
        break;
    default: /* demons_win */
        g_asym_rules->demons_won = 1;
        g_asym_rules->win_countdown = 3 * TICRATE;
        break;
    }
}

void asym_rules_on_secret(int sector_index, int secret_count)
{
    asym_event ev;
    char reason[32];

    fprintf(stderr, "[asym] secret sector %d (count %d)\n", sector_index, secret_count);
    if (!g_asym_rules || !g_asym_rules->events) return;

    snprintf(reason, sizeof(reason), "%d", sector_index);
    asym_event_make(&ev, ASYM_EV_SECRET, NULL, 0, NULL, reason);
    ev.points = secret_count;
    asym_events_push(g_asym_rules->events, &ev);
}

void asym_rules_try_buy(int slot, int mod_index)
{
    asym_controller *c = asym_control_by_slot(slot);
    const asym_upgrade_table *table;
    int *lvl;
    int next;
    int cost;
    if (!c || c->role != 2) return;
    if (mod_index < 0 || mod_index >= ASYM_UPGRADE_COUNT) return;
    table = &asym_upgrades[mod_index];
    lvl = &((int *)&c->mods)[mod_index];
    next = *lvl + 1;
    if (next >= table->count) return;
    cost = table->levels[next].cost;
    if (c->points < cost) return;
    c->points -= cost;
    (*lvl) = next;
    if (mod_index == ASYM_UPGRADE_HEALTH && c->body_id) {
        mobj_t *mo = asym_actors_find(c->body_id);
        if (mo) {
            int oldmax = mo->info->spawnhealth
                * upgrade_scalar(ASYM_UPGRADE_HEALTH, *lvl - 1) / 100;
            int newmax = mo->info->spawnhealth
                * upgrade_scalar(ASYM_UPGRADE_HEALTH, *lvl) / 100;
            mo->health += (newmax - oldmax);
        }
    }
    {
        asym_event ev;
        asym_event_make(&ev, ASYM_EV_MODS, c->session_id, c->body_id, NULL, "buy");
        ev.points = c->points;
        ev.mods = c->mods;
        if (g_asym_rules && g_asym_rules->events) asym_events_push(g_asym_rules->events, &ev);
    }
}

void asym_rules_survival_tick(int slot)
{
    asym_controller *c = asym_control_by_slot(slot);
    if (!c || c->role != 2 || !c->body_id) return;
    if (leveltime > 0 && (leveltime % (5 * TICRATE)) == 0) {
        c->points += 1;
        {
            asym_event ev;
            asym_event_make(&ev, ASYM_EV_POINTS, c->session_id, c->body_id, NULL, "survive");
            ev.points = c->points;
            if (g_asym_rules && g_asym_rules->events) asym_events_push(g_asym_rules->events, &ev);
        }
    }
}

int asym_rules_is_consumable_deco(int mobjtype)
{
    switch ((mobjtype_t)mobjtype) {
    case MT_MISC61: case MT_MISC62: case MT_MISC63: case MT_MISC64:
    case MT_MISC65: case MT_MISC66: case MT_MISC67: case MT_MISC68:
    case MT_MISC69: case MT_MISC71:
    case MT_MISC84: case MT_MISC85: case MT_MISC86:
        return 1;
    default:
        return 0;
    }
}

static int is_edible(mobj_t *thing)
{
    if (!thing) return 0;
    if (thing->flags & MF_CORPSE) return 1;
    return asym_rules_is_consumable_deco((int)thing->type);
}

static void push_hot_stack(asym_controller *c)
{
    int i;
    /* Prefer empty slot; else drop oldest (index 0) and shift. */
    for (i = 0; i < ASYM_HOT_STACKS; i++) {
        if (c->hots[i].tics_left <= 0) {
            c->hots[i].hp_left = ASYM_CONSUME_HEAL_TOTAL;
            c->hots[i].tics_left = ASYM_CONSUME_HEAL_TICS;
            return;
        }
    }
    for (i = 0; i < ASYM_HOT_STACKS - 1; i++)
        c->hots[i] = c->hots[i + 1];
    c->hots[ASYM_HOT_STACKS - 1].hp_left = ASYM_CONSUME_HEAL_TOTAL;
    c->hots[ASYM_HOT_STACKS - 1].tics_left = ASYM_CONSUME_HEAL_TICS;
}

void asym_rules_heal_tick(int slot)
{
    asym_controller *c = asym_control_by_slot(slot);
    mobj_t *mo;
    int i, maxhp;

    if (!c || c->role != 2 || !c->body_id) return; /* pause while spectating */
    mo = asym_actors_find(c->body_id);
    if (!mo || mo->health <= 0) return;

    maxhp = mo->info->spawnhealth
        * upgrade_scalar(ASYM_UPGRADE_HEALTH, c->mods.health) / 100;
    for (i = 0; i < ASYM_HOT_STACKS; i++) {
        int elapsed, target, healed, heal;
        if (c->hots[i].tics_left <= 0) continue;

        /* Spread ASYM_CONSUME_HEAL_TOTAL evenly across ASYM_CONSUME_HEAL_TICS.
           ceil(hp/tics) would dump +1/tic and finish in ~10 tics (~0.3s). */
        elapsed = ASYM_CONSUME_HEAL_TICS - c->hots[i].tics_left + 1;
        if (elapsed > ASYM_CONSUME_HEAL_TICS) elapsed = ASYM_CONSUME_HEAL_TICS;
        target = ASYM_CONSUME_HEAL_TOTAL * elapsed / ASYM_CONSUME_HEAL_TICS;
        healed = ASYM_CONSUME_HEAL_TOTAL - c->hots[i].hp_left;
        heal = target - healed;
        if (heal > c->hots[i].hp_left) heal = c->hots[i].hp_left;
        if (heal > 0) {
            mo->health += heal;
            if (mo->health > maxhp) mo->health = maxhp;
            c->hots[i].hp_left -= heal;
        }
        c->hots[i].tics_left--;
        if (c->hots[i].tics_left <= 0 || c->hots[i].hp_left <= 0) {
            c->hots[i].hp_left = 0;
            c->hots[i].tics_left = 0;
        }
    }
}

int asym_rules_try_consume(int slot, mobj_t *mo)
{
    asym_controller *c = asym_control_by_slot(slot);
    thinker_t *th;
    mobj_t *best = NULL;
    fixed_t bestdist = 0;
    int is_kill;
    asym_event ev;
    const char *reason;

    if (!c || !mo || c->role != 2) return 0;

    /* Thinker walk so MF_NOBLOCKMAP gore props are still found. */
    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        mobj_t *thing;
        fixed_t dist;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        thing = (mobj_t *)th;
        if (thing == mo) continue;
        if (!is_edible(thing)) continue;
        dist = P_AproxDistance(thing->x - mo->x, thing->y - mo->y);
        if (dist > USERANGE) continue;
        if (!best || dist < bestdist) {
            best = thing;
            bestdist = dist;
        }
    }
    if (!best) return 0;

    is_kill = (best->flags & MF_CORPSE) != 0;
    if (is_kill) {
        c->points += ASYM_CONSUME_KILL_POINTS;
        push_hot_stack(c);
        reason = "consume";
    } else {
        c->points += ASYM_CONSUME_DECO_POINTS;
        reason = "scavenge";
    }

    S_StartSound(mo, sfx_slop);
    P_RemoveMobj(best);

    asym_event_make(&ev, ASYM_EV_POINTS, c->session_id, c->body_id, NULL, reason);
    ev.points = c->points;
    if (g_asym_rules && g_asym_rules->events) asym_events_push(g_asym_rules->events, &ev);
    return 1;
}

int asym_rules_scale_damage(mobj_t *source, int damage)
{
    asym_controller *c;
    if (!source || source->asym_controller < 0) return damage;
    c = asym_control_by_slot(source->asym_controller);
    if (!c) return damage;
    return damage * upgrade_scalar(ASYM_UPGRADE_DAMAGE, c->mods.damage) / 100;
}

void asym_rules_award_damage(mobj_t *source, mobj_t *target, int damage)
{
    asym_controller *c;
    if (!source || source->asym_controller < 0) return;
    c = asym_control_by_slot(source->asym_controller);
    if (!c) return;
    if (target && target->type == MT_PLAYER) {
        c->points += damage / 2;
    } else {
        c->points += damage / 4;
    }
}

void asym_rules_on_level_start(asym_rules_state *st)
{
    int i;
    asym_event ev;
    st->map_ready = 1;
    st->want_round_reload = 0;
    st->need_round_reload = 0;
    st->win_countdown = 0;

    /* Apply pending marine rotation */
    if (st->pending_marine_slot >= 0) {
        /* demote old marine */
        if (st->marine_slot >= 0 && st->marine_slot != st->pending_marine_slot) {
            asym_controller *old = asym_control_by_slot(st->marine_slot);
            if (old) {
                old->role = 2;
                asym_rules_possess_auto(st->marine_slot, 1);
            }
        }
        st->marine_slot = st->pending_marine_slot;
        st->pending_marine_slot = -1;
        {
            asym_controller *m = asym_control_by_slot(st->marine_slot);
            if (m) {
                m->role = 1;
                m->body_id = 0;
                /* bind to player mobj actor id if present */
                if (players[consoleplayer].mo) {
                    m->body_id = players[consoleplayer].mo->asym_actor_id;
                }
            }
        }
    }

    /* Re-bind demons without body */
    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        asym_controller *c = asym_control_by_slot(i);
        if (!c) continue;
        if (c->role == 1) continue;
        if (c->role == 2 || c->role == 3) {
            c->body_id = 0;
            c->hopcool = 0;
            c->hoptics = 0;
            asym_rules_possess_auto(i, 1);
        }
    }

    asym_event_make(&ev, ASYM_EV_MAP_LOADED, NULL, 0, NULL, "level");
    if (st->events) asym_events_push(st->events, &ev);
}

void asym_rules_ticker(asym_rules_state *st)
{
    if (!st) return;
    if (st->win_countdown > 0) {
        st->win_countdown--;
        if (st->win_countdown == 0) {
            if (st->want_round_reload) {
                st->need_round_reload = 1;
                push_ev(ASYM_EV_ROUND_RELOAD, NULL, 0, NULL, "now");
            }
        }
    }
}
