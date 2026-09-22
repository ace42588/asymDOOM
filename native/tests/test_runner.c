/*
 * Native test runner: create/tick/snapshot, possess+move, hop cycle/cooldown,
 * death→possess-next, marine-death→killer (smoke-level against real E1M1).
 */
#include "asym_embed.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* SFX ids mirror sounds.h — avoid linking S_StartSound directly on Darwin. */
enum {
    TEST_SFX_DOROPN = 20,
    TEST_SFX_STNMOV = 22,
    TEST_SFX_SWTCHN = 23,
    TEST_SFX_PLPAIN = 25
};

static int fails = 0;

#define CHECK(cond, msg) do { \
    if (!(cond)) { fprintf(stderr, "FAIL: %s\n", msg); fails++; } \
    else { fprintf(stderr, "ok: %s\n", msg); } \
} while (0)

static const char *wad_path(void)
{
    const char *w = getenv("ASYM_WAD");
    return w && w[0] ? w : "../assets/doom1.wad";
}

static asym_embed *make_embed_map(int episode, int map);
static asym_embed *make_embed(void);

static asym_embed *make_embed_map(int episode, int map)
{
    asym_config cfg = {0};
    cfg.iwad_path = wad_path();
    cfg.skill = 3;
    cfg.episode = episode;
    cfg.map = map;
    cfg.marine_death = 1; /* respawn_as_killer */
    cfg.possess_mask = 0xff;
    return asym_create(&cfg);
}

static asym_embed *make_embed(void)
{
    return make_embed_map(1, 1);
}

static void tick_through_round_reload(asym_embed *e)
{
    int i;
    for (i = 0; i < 3 * 35; i++) asym_tick(e);
}

static void test_create_tick_snapshot(void)
{
    asym_embed *e = make_embed();
    asym_snapshot snap;
    int i, monsters = 0;
    CHECK(e != NULL, "create");
    if (!e) return;
    for (i = 0; i < 35; i++) asym_tick(e);
    asym_get_snapshot(e, &snap);
    CHECK(snap.tick > 0, "tick advanced");
    CHECK(strcmp(snap.map_name, "E1M1") == 0, "mapName E1M1");
    CHECK(snap.actor_count > 5, "E1M1 has many actors");
    for (i = 0; i < snap.actor_count; i++) {
        if (snap.actors[i].kind == 1) monsters++;
    }
    CHECK(monsters >= 4, "E1M1 monster roster");
    /* Known E1M1 player start roughly near (1056, -3616) in map units — allow slack */
    {
        int found_marine = 0;
        int found_item = 0;
        int items = 0;
        for (i = 0; i < snap.actor_count; i++) {
            if (snap.actors[i].kind == 0) found_marine = 1;
            if (snap.actors[i].kind == 2) {
                found_item = 1;
                items++;
            }
        }
        CHECK(found_marine, "marine present");
        CHECK(found_item, "pickup items present");
        CHECK(items >= 4, "E1M1 has several pickups");
    }
    CHECK(snap.switch_count == 0, "no flipped switches at map start");
    asym_destroy(e);
}

static void test_possess_and_move(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot before, after;
    uint32_t body;
    float dx, dy, bx = 0, by = 0, ax = 0, ay = 0;
    int j;
    CHECK(e != NULL, "create possess");
    if (!e) return;
    asym_register_session(e, "marine-s");
    asym_register_session(e, "demon-s");
    body = asym_body(e, "demon-s");
    CHECK(body != 0, "demon possessed a body");

    /* Auto-assign prefers mobile bodies — first claim should walk. */
    asym_get_snapshot(e, &before);
    in.forward = 50;
    in.run = 1;
    in.turn_delta = 256;
    for (j = 0; j < 35; j++) {
        asym_submit_input(e, "demon-s", &in);
        asym_tick(e);
    }
    asym_get_snapshot(e, &after);
    for (j = 0; j < before.actor_count; j++)
        if (before.actors[j].id == body) { bx = before.actors[j].x; by = before.actors[j].y; }
    for (j = 0; j < after.actor_count; j++)
        if (after.actors[j].id == body) { ax = after.actors[j].x; ay = after.actors[j].y; }
    dx = ax - bx; dy = ay - by;
    fprintf(stderr, "  move body=%u dx=%.3f dy=%.3f\n", body, dx, dy);
    CHECK(dx * dx + dy * dy > 0.01f, "first auto body moved");
    asym_destroy(e);
}

static void test_auto_possess_varies(void)
{
    asym_embed *e = make_embed();
    uint32_t ids[24];
    int n = 0, i, j, distinct = 0;
    CHECK(e != NULL, "create vary");
    if (!e) return;
    asym_register_session(e, "m");
    asym_register_session(e, "d");
    /* Release + auto-possess advances M_Random without map reset. */
    for (i = 0; i < 16; i++) {
        uint32_t body = asym_body(e, "d");
        CHECK(body != 0, "auto body claimed");
        if (body) {
            ids[n++] = body;
            fprintf(stderr, "  auto body trial %d id=%u\n", i, (unsigned)body);
        }
        asym_release(e, "d");
        CHECK(asym_possess(e, "d", 0) != 0, "re-possess auto");
    }
    for (i = 0; i < n; i++) {
        int seen = 0;
        for (j = 0; j < i; j++)
            if (ids[j] == ids[i]) seen = 1;
        if (!seen) distinct++;
    }
    fprintf(stderr, "  auto-possess distinct=%d / %d\n", distinct, n);
    CHECK(distinct > 1, "auto-possess ids vary across trials");
    asym_destroy(e);
}

static void test_hop_cycle(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    uint32_t b1, b2;
    int i;
    CHECK(e != NULL, "create hop");
    if (!e) return;
    asym_register_session(e, "m");
    asym_register_session(e, "d");
    b1 = asym_body(e, "d");
    in.arti = 5;
    asym_submit_input(e, "d", &in);
    asym_tick(e);
    b2 = asym_body(e, "d");
    CHECK(b2 != 0 && b2 != b1, "hop to different body");
    /* cooldown: immediate hop should fail (same body) */
    for (i = 0; i < 3; i++) {
        in.arti = 5;
        asym_submit_input(e, "d", &in);
        asym_tick(e);
    }
    CHECK(asym_body(e, "d") == b2, "hop cooldown holds body");
    asym_destroy(e);
}

#define MF_CORPSE_FLAG 0x100000
#define MF_SPECIAL_FLAG 1

static int is_gore_deco_type(int t)
{
    return (t >= 111 && t <= 119) || t == 121 || (t >= 134 && t <= 136);
}

static float ang_wrap(float d)
{
    while (d > 180.f) d -= 360.f;
    while (d < -180.f) d += 360.f;
    return d;
}

static int turn_toward_deg(float cur_deg, float dx, float dy)
{
    float want = atan2f(dy, dx) * (180.f / 3.14159265f);
    float d = ang_wrap(want - cur_deg);
    int td = (int)(d * 65536.f / 360.f);
    if (td > 2048) td = 2048;
    if (td < -2048) td = -2048;
    return td;
}

static void drain_events(asym_embed *e)
{
    asym_event evs[64];
    while (asym_events_pull(e, evs, 64) > 0) { }
}

static void test_consume_corpse(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot snap;
    asym_event evs[32];
    uint32_t body = 0, victim = 0;
    float bx = 0, by = 0, bang = 0, vx = 0, vy = 0;
    int i, pts0, pts1, health0 = 0, health1 = 0;
    int got_consume = 0, victim_gone = 0;
    int n;
    int pair_ok = 0;

    CHECK(e != NULL, "create consume");
    if (!e) return;

    asym_register_session(e, "m");
    asym_register_session(e, "d");
    for (i = 0; i < 16; i++) asym_tick(e);

    /* No-op use (auto-possessed body, no corpses yet). */
    body = asym_body(e, "d");
    CHECK(body != 0, "consume: possessed a body");
    if (!body) {
        asym_destroy(e);
        return;
    }
    drain_events(e);
    pts0 = asym_points(e, "d");
    memset(&in, 0, sizeof(in));
    in.use = 1;
    asym_submit_input(e, "d", &in);
    asym_tick(e);
    in.use = 0;
    asym_submit_input(e, "d", &in);
    asym_tick(e);
    CHECK(asym_points(e, "d") == pts0, "use without corpse does not change points");

    /* Find a close hunter/victim pair (ranged hunter, any living victim). */
    asym_get_snapshot(e, &snap);
    {
        float bestd = 1e12f;
        int a, b;
        for (a = 0; a < snap.actor_count; a++) {
            const char *an;
            if (snap.actors[a].kind != 1) continue;
            if (snap.actors[a].health <= 0) continue;
            if (snap.actors[a].flags & MF_CORPSE_FLAG) continue;
            an = snap.actors[a].type_name;
            if (strcmp(an, "zombieman") && strcmp(an, "shotgunner")
                && strcmp(an, "imp") && strcmp(an, "cacodemon")
                && strcmp(an, "baron"))
                continue;
            for (b = 0; b < snap.actor_count; b++) {
                float dx, dy, d;
                if (a == b) continue;
                if (snap.actors[b].kind != 1) continue;
                if (snap.actors[b].health <= 0) continue;
                if (snap.actors[b].flags & MF_CORPSE_FLAG) continue;
                dx = snap.actors[a].x - snap.actors[b].x;
                dy = snap.actors[a].y - snap.actors[b].y;
                d = dx * dx + dy * dy;
                if (d < bestd && d < 180.f * 180.f) {
                    bestd = d;
                    body = snap.actors[a].id;
                    victim = snap.actors[b].id;
                    pair_ok = 1;
                }
            }
        }
        fprintf(stderr, "  pair body=%u victim=%u dist=%.1f\n",
                body, victim, pair_ok ? sqrtf(bestd) : -1.f);
    }
    CHECK(pair_ok, "consume: found close hunter/victim pair");
    if (!pair_ok) {
        asym_destroy(e);
        return;
    }
    CHECK(asym_possess(e, "d", body) == 1, "consume: possess hunter");
    body = asym_body(e, "d");

    /* Chase + fire until victim is a corpse. */
    for (i = 0; i < 900; i++) {
        int j, found = 0;
        float dx, dy, dist;
        asym_get_snapshot(e, &snap);
        for (j = 0; j < snap.actor_count; j++) {
            if (snap.actors[j].id == body) {
                bx = snap.actors[j].x;
                by = snap.actors[j].y;
                bang = snap.actors[j].angle;
                health0 = snap.actors[j].health;
            }
            if (snap.actors[j].id == victim) {
                found = 1;
                vx = snap.actors[j].x;
                vy = snap.actors[j].y;
                if (snap.actors[j].flags & MF_CORPSE_FLAG) goto corpse_ready;
            }
        }
        if (!found) {
            fprintf(stderr, "  victim vanished at tick %d\n", i);
            break;
        }
        dx = vx - bx;
        dy = vy - by;
        dist = sqrtf(dx * dx + dy * dy);
        memset(&in, 0, sizeof(in));
        in.turn_delta = turn_toward_deg(bang, dx, dy);
        in.fire = 1;
        in.run = 1;
        if (dist > 40.f) in.forward = 50;
        asym_submit_input(e, "d", &in);
        memset(&in, 0, sizeof(in));
        asym_submit_input(e, "m", &in);
        asym_tick(e);
    }
    CHECK(0, "consume: victim became MF_CORPSE");
    asym_destroy(e);
    return;

corpse_ready:
    fprintf(stderr, "  corpse ready victim=%u at (%.1f,%.1f)\n", victim, vx, vy);

    /* Close to corpse if needed (USERANGE = 64). */
    for (i = 0; i < 120; i++) {
        int j;
        float dx, dy, dist;
        asym_get_snapshot(e, &snap);
        for (j = 0; j < snap.actor_count; j++) {
            if (snap.actors[j].id == body) {
                bx = snap.actors[j].x;
                by = snap.actors[j].y;
                bang = snap.actors[j].angle;
                health0 = snap.actors[j].health;
            }
            if (snap.actors[j].id == victim) {
                vx = snap.actors[j].x;
                vy = snap.actors[j].y;
            }
        }
        dx = vx - bx;
        dy = vy - by;
        dist = sqrtf(dx * dx + dy * dy);
        if (dist <= 56.f) break;
        memset(&in, 0, sizeof(in));
        in.turn_delta = turn_toward_deg(bang, dx, dy);
        in.forward = 50;
        in.run = 1;
        asym_submit_input(e, "d", &in);
        asym_tick(e);
    }

    {
        float dist = sqrtf((vx - bx) * (vx - bx) + (vy - by) * (vy - by));
        fprintf(stderr, "  demon at (%.1f,%.1f) dist=%.1f health=%d pts=%d\n",
                bx, by, dist, health0, asym_points(e, "d"));
        CHECK(dist <= 64.f, "consume: demon within USERANGE of corpse");
        if (dist > 64.f) {
            asym_destroy(e);
            return;
        }
    }

    drain_events(e);
    pts0 = asym_points(e, "d");
    health0 = 0;
    asym_get_snapshot(e, &snap);
    for (i = 0; i < snap.actor_count; i++)
        if (snap.actors[i].id == body) health0 = snap.actors[i].health;

    memset(&in, 0, sizeof(in));
    in.use = 1;
    asym_submit_input(e, "d", &in);
    asym_tick(e);
    in.use = 0;
    asym_submit_input(e, "d", &in);
    asym_tick(e);

    pts1 = asym_points(e, "d");
    CHECK(pts1 == pts0 + 25, "consume awards +25 points");

    n = asym_events_pull(e, evs, 32);
    for (i = 0; i < n; i++) {
        if (evs[i].kind == ASYM_EV_POINTS && !strcmp(evs[i].reason, "consume")) {
            got_consume = 1;
            CHECK(evs[i].points == pts1, "consume event points match wallet");
        }
    }
    CHECK(got_consume, "consume points event reason=consume");

    asym_get_snapshot(e, &snap);
    victim_gone = 1;
    health1 = health0;
    for (i = 0; i < snap.actor_count; i++) {
        if (snap.actors[i].id == victim) victim_gone = 0;
        if (snap.actors[i].id == body) health1 = snap.actors[i].health;
    }
    CHECK(victim_gone, "consumed corpse removed from snapshot");
    /* HoT must not dump the full +10 in the first couple of tics. */
    CHECK(health1 <= health0 + 1, "consume HoT is not near-instant");

    /* After ~1s expect little heal; after full 5s expect most of the +10. */
    {
        int hot_base = health1;
        int mid = hot_base, end = hot_base;
        for (i = 0; i < 35; i++) {
            memset(&in, 0, sizeof(in));
            asym_submit_input(e, "d", &in);
            asym_tick(e);
        }
        asym_get_snapshot(e, &snap);
        for (i = 0; i < snap.actor_count; i++)
            if (snap.actors[i].id == body) mid = snap.actors[i].health;
        for (i = 0; i < 150; i++) {
            memset(&in, 0, sizeof(in));
            asym_submit_input(e, "d", &in);
            asym_tick(e);
        }
        asym_get_snapshot(e, &snap);
        for (i = 0; i < snap.actor_count; i++)
            if (snap.actors[i].id == body) end = snap.actors[i].health;
        fprintf(stderr, "  HoT health %d -> %d (1s) -> %d (5s)\n", hot_base, mid, end);
        CHECK(mid - hot_base <= 3, "consume HoT only a little after ~1s");
        CHECK(end > mid, "consume HoT continues after first second");
        CHECK(end - hot_base >= 8, "consume HoT delivers most heal by ~5s");
    }

    asym_destroy(e);
}

static void test_scavenge_decoration(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot snap;
    asym_event evs[32];
    uint32_t body = 0, deco = 0;
    float bx = 0, by = 0, bang = 0, dx0 = 0, dy0 = 0;
    float bestd = 1e12f;
    int i, j, a, pts0, pts1, health0 = 0, health1 = 0;
    int got_scavenge = 0, deco_gone = 0, n, pair_ok = 0;

    CHECK(e != NULL, "create scavenge");
    if (!e) return;

    asym_register_session(e, "m");
    asym_register_session(e, "d");
    for (i = 0; i < 16; i++) asym_tick(e);

    asym_get_snapshot(e, &snap);
    /* Closest possessable body ↔ gore decoration, with no kill-corpse in the way. */
    for (a = 0; a < snap.actor_count; a++) {
        const char *an;
        if (snap.actors[a].kind != 1) continue;
        if (snap.actors[a].health <= 0) continue;
        if (snap.actors[a].flags & MF_CORPSE_FLAG) continue;
        an = snap.actors[a].type_name;
        if (strcmp(an, "zombieman") && strcmp(an, "shotgunner")
            && strcmp(an, "imp") && strcmp(an, "demon")
            && strcmp(an, "spectre") && strcmp(an, "lostsoul")
            && strcmp(an, "cacodemon") && strcmp(an, "baron"))
            continue;
        for (j = 0; j < snap.actor_count; j++) {
            float dx, dy, d;
            int k, corpse_near = 0;
            if (snap.actors[j].kind != 2) continue;
            if (snap.actors[j].flags & MF_SPECIAL_FLAG) continue;
            if (!is_gore_deco_type(snap.actors[j].type)) continue;
            dx = snap.actors[a].x - snap.actors[j].x;
            dy = snap.actors[a].y - snap.actors[j].y;
            d = dx * dx + dy * dy;
            if (d >= bestd || d >= 200.f * 200.f) continue;
            /* Skip if a kill-corpse is nearer than / within use of the deco. */
            for (k = 0; k < snap.actor_count; k++) {
                float cx, cy, cd;
                if (!(snap.actors[k].flags & MF_CORPSE_FLAG)) continue;
                cx = snap.actors[k].x - snap.actors[a].x;
                cy = snap.actors[k].y - snap.actors[a].y;
                cd = cx * cx + cy * cy;
                if (cd < 80.f * 80.f) { corpse_near = 1; break; }
            }
            if (corpse_near) continue;
            bestd = d;
            body = snap.actors[a].id;
            deco = snap.actors[j].id;
            dx0 = snap.actors[j].x;
            dy0 = snap.actors[j].y;
            pair_ok = 1;
        }
    }
    fprintf(stderr, "  scavenge pair body=%u deco=%u dist=%.1f\n",
            body, deco, pair_ok ? sqrtf(bestd) : -1.f);
    CHECK(pair_ok, "scavenge: found body near gore decoration");
    if (!pair_ok) {
        asym_destroy(e);
        return;
    }
    CHECK(asym_possess(e, "d", body) == 1, "scavenge: possess near deco");
    body = asym_body(e, "d");

    for (i = 0; i < 300; i++) {
        float dx, dy, dist;
        asym_get_snapshot(e, &snap);
        for (j = 0; j < snap.actor_count; j++) {
            if (snap.actors[j].id == body) {
                bx = snap.actors[j].x;
                by = snap.actors[j].y;
                bang = snap.actors[j].angle;
                health0 = snap.actors[j].health;
            }
            if (snap.actors[j].id == deco) {
                dx0 = snap.actors[j].x;
                dy0 = snap.actors[j].y;
            }
        }
        dx = dx0 - bx;
        dy = dy0 - by;
        dist = sqrtf(dx * dx + dy * dy);
        if (dist <= 56.f) break;
        memset(&in, 0, sizeof(in));
        in.turn_delta = turn_toward_deg(bang, dx, dy);
        in.forward = 50;
        in.run = 1;
        asym_submit_input(e, "d", &in);
        asym_tick(e);
    }

    {
        float dist = sqrtf((dx0 - bx) * (dx0 - bx) + (dy0 - by) * (dy0 - by));
        fprintf(stderr, "  scavenge dist=%.1f health=%d\n", dist, health0);
        CHECK(dist <= 64.f, "scavenge: within USERANGE of decoration");
        if (dist > 64.f) {
            asym_destroy(e);
            return;
        }
    }

    drain_events(e);
    pts0 = asym_points(e, "d");
    health0 = 0;
    asym_get_snapshot(e, &snap);
    for (i = 0; i < snap.actor_count; i++)
        if (snap.actors[i].id == body) health0 = snap.actors[i].health;

    /* Doors/switches win when ahead — try several facings until scavenge lands. */
    got_scavenge = 0;
    for (i = 0; i < 16 && !got_scavenge; i++) {
        memset(&in, 0, sizeof(in));
        in.turn_delta = 2048; /* ~11° */
        asym_submit_input(e, "d", &in);
        asym_tick(e);

        drain_events(e);
        pts0 = asym_points(e, "d");
        memset(&in, 0, sizeof(in));
        in.use = 1;
        asym_submit_input(e, "d", &in);
        asym_tick(e);
        in.use = 0;
        asym_submit_input(e, "d", &in);
        asym_tick(e);

        pts1 = asym_points(e, "d");
        n = asym_events_pull(e, evs, 32);
        for (j = 0; j < n; j++) {
            if (evs[j].kind == ASYM_EV_POINTS && !strcmp(evs[j].reason, "scavenge")) {
                got_scavenge = 1;
                CHECK(pts1 == pts0 + 10, "scavenge awards +10 points");
                CHECK(evs[j].points == pts1, "scavenge event points match wallet");
            }
        }
    }
    CHECK(got_scavenge, "scavenge points event reason=scavenge");

    asym_get_snapshot(e, &snap);
    deco_gone = 1;
    for (i = 0; i < snap.actor_count; i++) {
        if (snap.actors[i].id == deco) deco_gone = 0;
        if (snap.actors[i].id == body) health1 = snap.actors[i].health;
    }
    CHECK(deco_gone, "scavenged decoration removed from snapshot");
    CHECK(health1 == health0, "scavenge does not change health");

    asym_destroy(e);
}

static void test_event_queue_unit(void)
{
    /* Light compile-linked check via create pull */
    asym_embed *e = make_embed();
    asym_event evs[16];
    int n;
    CHECK(e != NULL, "create events");
    if (!e) return;
    n = asym_events_pull(e, evs, 16);
    CHECK(n >= 1, "mapLoaded event present");
    {
        int found = 0, i;
        for (i = 0; i < n; i++) if (evs[i].kind == ASYM_EV_MAP_LOADED) found = 1;
        CHECK(found, "mapLoaded kind");
    }
    CHECK(asym_sizeof_snapshot() > 100, "sizeof snapshot");
    asym_destroy(e);
}

static void test_marine_fire_and_weapon(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot snap;
    int ammo0, ammo1, weapon0;
    int i;
    CHECK(e != NULL, "create fire");
    if (!e) return;
    asym_register_session(e, "marine-s");
    asym_get_snapshot(e, &snap);
    ammo0 = snap.marine.ammo;
    weapon0 = snap.marine.weapon;
    CHECK(ammo0 > 0, "marine starts with ammo");
    CHECK(weapon0 == 1, "marine starts with pistol");

    in.fire = 1;
    for (i = 0; i < 70; i++) {
        asym_submit_input(e, "marine-s", &in);
        asym_tick(e);
    }
    asym_get_snapshot(e, &snap);
    ammo1 = snap.marine.ammo;
    fprintf(stderr, "  fire ammo %d -> %d\n", ammo0, ammo1);
    CHECK(ammo1 < ammo0, "firing spends ammo");

    memset(&in, 0, sizeof(in));
    in.arti = 1; /* fist */
    asym_submit_input(e, "marine-s", &in);
    for (i = 0; i < 40; i++) {
        if (i == 1) {
            in.arti = 0;
            asym_submit_input(e, "marine-s", &in);
        }
        asym_tick(e);
    }
    asym_get_snapshot(e, &snap);
    fprintf(stderr, "  weapon after fist select=%d\n", snap.marine.weapon);
    CHECK(snap.marine.weapon == 0, "arti 1 selects fist");
    asym_destroy(e);
}

static void test_demon_fire_projectile(void)
{
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot snap;
    int i, got = 0;
    CHECK(e != NULL, "create demon fire");
    if (!e) return;
    asym_register_session(e, "m");
    asym_register_session(e, "d");
    for (i = 0; i < 16 && !got; i++) {
        int t, j;
        const char *sp = "";
        uint32_t body = asym_body(e, "d");
        asym_get_snapshot(e, &snap);
        for (j = 0; j < snap.actor_count; j++) {
            if (snap.actors[j].id == body) {
                sp = snap.actors[j].type_name;
                break;
            }
        }
        fprintf(stderr, "  demon fire try body=%u species=%s\n", body, sp);
        if (strcmp(sp, "imp") == 0 || strcmp(sp, "cacodemon") == 0 || strcmp(sp, "baron") == 0) {
            in.fire = 1;
            in.arti = 0;
            for (t = 0; t < 8; t++) {
                asym_submit_input(e, "d", &in);
                asym_tick(e);
                asym_get_snapshot(e, &snap);
                if (snap.projectile_count > 0) {
                    got = 1;
                    break;
                }
            }
            if (got) break;
        }
        in.fire = 0;
        in.arti = 5;
        for (t = 0; t < 80; t++) asym_tick(e);
        asym_submit_input(e, "d", &in);
        asym_tick(e);
        in.arti = 0;
    }
    CHECK(got, "demon attack spawned a projectile");
    asym_destroy(e);
}

static void test_imp_fire_no_double_shot(void)
{
    /* Imp ATK frames run A_FaceTarget (8) + A_FaceTarget (8) + A_TroopAttack (6).
       Possessed fire must spawn exactly one fireball and must not snap pose. */
    asym_embed *e = make_embed();
    asym_input in = {0};
    asym_snapshot snap;
    int i, got_imp = 0;
    uint32_t body = 0;
    float ax0 = 0, ay0 = 0, aang0 = 0;
    CHECK(e != NULL, "create imp fire");
    if (!e) return;
    asym_register_session(e, "m");
    asym_register_session(e, "d");
    for (i = 0; i < 16 && !got_imp; i++) {
        int j;
        body = asym_body(e, "d");
        asym_get_snapshot(e, &snap);
        for (j = 0; j < snap.actor_count; j++) {
            if (snap.actors[j].id == body && strcmp(snap.actors[j].type_name, "imp") == 0) {
                ax0 = snap.actors[j].x;
                ay0 = snap.actors[j].y;
                aang0 = snap.actors[j].angle;
                got_imp = 1;
                break;
            }
        }
        if (got_imp) break;
        in.arti = 5;
        {
            int t;
            for (t = 0; t < 80; t++) asym_tick(e);
            asym_submit_input(e, "d", &in);
            asym_tick(e);
            in.arti = 0;
        }
    }
    CHECK(got_imp, "possessed an imp");
    if (!got_imp) {
        asym_destroy(e);
        return;
    }

    memset(&in, 0, sizeof(in));
    in.fire = 1;
    asym_submit_input(e, "d", &in);
    asym_tick(e);
    in.fire = 0;
    asym_submit_input(e, "d", &in);

    {
        int t, max_proj = 0;
        float ax1 = ax0, ay1 = ay0, aang1 = aang0;
        for (t = 0; t < 30; t++) {
            int j;
            asym_tick(e);
            asym_get_snapshot(e, &snap);
            if (snap.projectile_count > max_proj) max_proj = snap.projectile_count;
            for (j = 0; j < snap.actor_count; j++) {
                if (snap.actors[j].id == body) {
                    ax1 = snap.actors[j].x;
                    ay1 = snap.actors[j].y;
                    aang1 = snap.actors[j].angle;
                }
            }
        }
        fprintf(stderr, "  imp fire max_proj=%d dpos=%.3f dang=%.3f\n",
                max_proj, hypot(ax1 - ax0, ay1 - ay0), aang1 - aang0);
        CHECK(max_proj == 1, "imp fire spawns one fireball (no A_TroopAttack double)");
        CHECK(fabs(aang1 - aang0) < 1.0, "imp fire does not snap angle (no A_FaceTarget)");
        CHECK(hypot(ax1 - ax0, ay1 - ay0) < 24.0, "imp fire does not yank position");
    }
    asym_destroy(e);
}

static void test_sound_capture(void)
{
    asym_embed *e = make_embed();
    asym_event evs[128];
    int n, i, got_door = 0, got_stnmov = 0, got_switch = 0, got_pain = 0;
    CHECK(e != NULL, "create sound");
    if (!e) return;

    drain_events(e);
    /* Inferred cues must not enqueue; leftover cues must. */
    asym_test_start_sound(TEST_SFX_DOROPN);
    asym_test_start_sound(TEST_SFX_STNMOV);
    asym_test_start_sound(TEST_SFX_SWTCHN);
    asym_test_start_sound(TEST_SFX_PLPAIN);
    n = asym_events_pull(e, evs, 128);
    for (i = 0; i < n; i++) {
        if (evs[i].kind != ASYM_EV_SOUND) continue;
        if (strcmp(evs[i].sound, "doropn") == 0) got_door = 1;
        if (strcmp(evs[i].sound, "stnmov") == 0) got_stnmov = 1;
        if (strcmp(evs[i].sound, "swtchn") == 0) got_switch = 1;
        if (strcmp(evs[i].sound, "plpain") == 0) got_pain = 1;
    }
    CHECK(!got_door, "inferred doropn not on wire");
    CHECK(!got_stnmov, "inferred stnmov not on wire");
    CHECK(got_switch, "swtchn sound event emitted");
    CHECK(got_pain, "plpain sound event emitted");
    asym_destroy(e);
}

static void test_switch_snapshot(void)
{
    asym_embed *e;
    asym_snapshot snap;
    int line, i, found;

    e = make_embed();
    CHECK(e != NULL, "create switch");
    if (!e) return;
    asym_get_snapshot(e, &snap);
    CHECK(snap.switch_count == 0, "clean map has no switch deltas");

    line = asym_test_flip_first_switch(1);
    CHECK(line >= 0, "found a switch linedef");
    asym_get_snapshot(e, &snap);
    found = 0;
    for (i = 0; i < snap.switch_count; i++) {
        if (snap.switches[i].id == line) found = 1;
    }
    CHECK(found, "button flip appears in snapshot");
    for (i = 0; i < 40; i++) asym_tick(e);
    asym_get_snapshot(e, &snap);
    found = 0;
    for (i = 0; i < snap.switch_count; i++) {
        if (snap.switches[i].id == line) found = 1;
    }
    CHECK(!found, "button revert drops switch from snapshot");

    line = asym_test_flip_first_switch(0);
    CHECK(line >= 0, "found a one-shot switch");
    asym_get_snapshot(e, &snap);
    found = 0;
    for (i = 0; i < snap.switch_count; i++) {
        if (snap.switches[i].id == line) found = 1;
    }
    CHECK(found, "one-shot flip appears in snapshot");
    for (i = 0; i < 40; i++) asym_tick(e);
    asym_get_snapshot(e, &snap);
    found = 0;
    for (i = 0; i < snap.switch_count; i++) {
        if (snap.switches[i].id == line) found = 1;
    }
    CHECK(found, "one-shot switch stays flipped");
    asym_destroy(e);
}

static void test_marine_death_player_vs_ai(void)
{
    asym_snapshot snap;
    asym_embed *e = make_embed_map(1, 3);
    CHECK(e != NULL, "create e1m3");
    if (!e) return;
    asym_register_session(e, "marine");
    asym_register_session(e, "demon");
    asym_get_snapshot(e, &snap);
    CHECK(strcmp(snap.map_name, "E1M3") == 0, "starts on E1M3");

    /* Player-controlled mob kill: reload same map, killer becomes marine. */
    asym_test_marine_death(1);
    tick_through_round_reload(e);
    asym_get_snapshot(e, &snap);
    CHECK(strcmp(snap.map_name, "E1M3") == 0, "player kill reloads same map");
    CHECK(asym_role(e, "demon") == 1, "killer becomes marine");
    CHECK(asym_role(e, "marine") == 2, "ex-marine becomes demon");
    asym_destroy(e);

    /* Game AI kill: restart at E1M1, marine player keeps role. */
    e = make_embed_map(1, 3);
    CHECK(e != NULL, "create e1m3 for ai kill");
    if (!e) return;
    asym_register_session(e, "marine");
    asym_test_marine_death(-1);
    tick_through_round_reload(e);
    asym_get_snapshot(e, &snap);
    CHECK(strcmp(snap.map_name, "E1M1") == 0, "AI kill reloads E1M1");
    CHECK(asym_role(e, "marine") == 1, "marine keeps role after AI kill");
    asym_destroy(e);
}

static void test_debug_sim_possessable(void)
{
    asym_embed *e = make_embed();
    asym_debug_sim dbg;
    int i, orphan_ctrl = 0;
    CHECK(e != NULL, "debug: create");
    if (!e) return;
    for (i = 0; i < 35; i++) asym_tick(e);
    asym_debug_sim_get(e, &dbg);
    CHECK(dbg.created, "debug: created");
    CHECK(dbg.rules_live, "debug: rules_live");
    CHECK(dbg.paused == 0, "debug: not paused");
    CHECK(dbg.gamestate == 0 /* GS_LEVEL */, "debug: GS_LEVEL");
    CHECK(dbg.possessable > 0, "debug: possessable > 0");
    CHECK(dbg.living_countkill > 0, "debug: living COUNTKILL");
    CHECK(dbg.controller_orphan == 0, "debug: no orphan controllers");
    for (i = 0; i < dbg.sample_count; i++) {
        if (dbg.samples[i].controller >= 0) orphan_ctrl++;
        /* Unpossessed samples must be AI (-1) before any session joins */
        CHECK(dbg.samples[i].controller == -1, "debug: sample controller == -1");
    }
    (void)orphan_ctrl;
    fprintf(stderr, "  debug: possessable=%d living=%d mobj=%d\n",
            dbg.possessable, dbg.living_countkill, dbg.thinker_mobj);
    asym_destroy(e);
}

int main(void)
{
    fprintf(stderr, "native tests wad=%s\n", wad_path());
    test_event_queue_unit();
    test_create_tick_snapshot();
    test_marine_death_player_vs_ai();
    test_debug_sim_possessable();
    test_possess_and_move();
    test_auto_possess_varies();
    test_hop_cycle();
    test_marine_fire_and_weapon();
    test_demon_fire_projectile();
    test_imp_fire_no_double_shot();
    test_consume_corpse();
    test_scavenge_decoration();
    test_sound_capture();
    test_switch_snapshot();
    if (fails) {
        fprintf(stderr, "%d FAIL(s)\n", fails);
        return 1;
    }
    fprintf(stderr, "all native tests passed\n");
    return 0;
}
