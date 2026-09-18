/*
 * asym_embed.h — Public C API for libasymdoom (authoritative native sim).
 * Single source of truth for FFI struct layouts (koffi mirrors these).
 */
#ifndef ASYM_EMBED_H
#define ASYM_EMBED_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ASYM_MAX_SESSIONS 16
#define ASYM_MAX_ACTORS 512
#define ASYM_MAX_DOORS 128
#define ASYM_MAX_MOVERS 128
#define ASYM_MAX_PROJECTILES 256
#define ASYM_MAX_EVENTS 64
#define ASYM_SESSION_ID_LEN 64

typedef struct asym_embed asym_embed;

typedef struct asym_config {
    const char *iwad_path; /* required: path to doom1.wad */
    int skill;             /* 0..4 */
    int episode;           /* 1..4 */
    int map;               /* 1..9 */
    int marine_death;      /* 0=demons_win 1=respawn_as_killer 2=marine_respawn */
    int possess_mask;      /* ASYM_P_* bits; 0 → default 0xff */
} asym_config;

typedef struct asym_input {
    int forward;    /* -50..50 */
    int strafe;     /* -50..50 */
    int turn_delta; /* angleturn units */
    int run;
    int fire;
    int use;
    int look_fly; /* 0 none, 1 up, 2 down */
    int arti;     /* 0 none, 1-4 buy mod, 5 hop */
} asym_input;

typedef struct asym_actor {
    uint32_t id;
    int kind; /* 0 marine, 1 monster, 2 item (pickup) */
    int type;
    char type_name[32];
    float x, y, z;
    float angle;
    float momx, momy, momz;
    int health;
    int max_health;
    int sprite;
    int frame;
    int flags;
    int controller; /* session slot or -1 */
    char controller_session_id[ASYM_SESSION_ID_LEN];
} asym_actor;

typedef struct asym_door {
    int id;
    int state; /* 0 closed, 1 open, 2 opening, 3 closing */
    float position;
    float x, y, z;
} asym_door;

/* Moving sector planes (plats, floors, ceilings — doors stay in asym_door). */
typedef struct asym_mover {
    int id;
    int kind;  /* 0 plat, 1 floor, 2 ceiling */
    int state; /* 0 idle/waiting, 1 up/opening, 2 down/closing */
    float floor;
    float ceiling;
    float x, y, z;
} asym_mover;

typedef struct asym_projectile {
    uint32_t id;
    int type;
    float x, y, z;
    float angle;
    float momx, momy, momz;
    int sprite;
    int frame;
} asym_projectile;

typedef struct asym_marine_vitals {
    int health;
    int armor;
    int ammo; /* ammo for ready weapon (or 0 for fist/saw) */
    int weapon;
    int ammo_counts[4]; /* am_clip, am_shell, am_cell, am_misl */
    int max_ammo[4];    /* same order as ammo_counts */
    int weapons; /* bit i set => weaponowned[i] */
    int cards; /* bit i set => cards[i] (blue/yellow/red card+skull) */
    int damagecount; /* >0 while taking damage (ouch face) */
} asym_marine_vitals;

typedef struct asym_mods {
    int health;
    int speed;
    int damage;
    int rate;
} asym_mods;

typedef struct asym_snapshot {
    int tick;
    char map_name[16];
    int actor_count;
    asym_actor actors[ASYM_MAX_ACTORS];
    int door_count;
    asym_door doors[ASYM_MAX_DOORS];
    int mover_count;
    asym_mover movers[ASYM_MAX_MOVERS];
    int projectile_count;
    asym_projectile projectiles[ASYM_MAX_PROJECTILES];
    asym_marine_vitals marine;
    int map_ready;
    int pending_reload;
} asym_snapshot;

typedef enum asym_event_kind {
    ASYM_EV_POSSESS = 1,
    ASYM_EV_RELEASE,
    ASYM_EV_HOP,
    ASYM_EV_HOPFAIL,
    ASYM_EV_SPECTATE,
    ASYM_EV_POINTS,
    ASYM_EV_MODS,
    ASYM_EV_PAIN,
    ASYM_EV_MARINE_KILL,
    ASYM_EV_ROUND_RELOAD,
    ASYM_EV_MAP_LOADED,
    ASYM_EV_SECRET,
    ASYM_EV_SOUND
} asym_event_kind;

typedef struct asym_event {
    int kind;
    char session_id[ASYM_SESSION_ID_LEN];
    uint32_t body_id;
    char species[32];
    char reason[32];
    int points;
    asym_mods mods;
    /* ASYM_EV_SOUND fields (appended for ABI growth) */
    char sound[16];
    float x, y, z;
    int has_origin;
} asym_event;

/* Lifecycle */
asym_embed *asym_create(const asym_config *cfg);
void asym_destroy(asym_embed *e);

/* Advance exactly one gametic (1/35s). Host-driven; no sleep. */
void asym_tick(asym_embed *e);

/* Session / possession */
int asym_register_session(asym_embed *e, const char *session_id);
void asym_unregister_session(asym_embed *e, const char *session_id);
void asym_submit_input(asym_embed *e, const char *session_id, const asym_input *in);
/* body_id == 0 means AUTO (hop-cycle pick). Returns 1 on success. */
int asym_possess(asym_embed *e, const char *session_id, uint32_t body_id);
void asym_release(asym_embed *e, const char *session_id);

/* Observation */
void asym_get_snapshot(asym_embed *e, asym_snapshot *out);
int asym_events_pull(asym_embed *e, asym_event *out, int max_out);

/* Session accessors */
int asym_role(asym_embed *e, const char *session_id); /* 0 none, 1 marine, 2 demon, 3 spectator */
uint32_t asym_body(asym_embed *e, const char *session_id);
int asym_points(asym_embed *e, const char *session_id);
void asym_mods_get(asym_embed *e, const char *session_id, asym_mods *out);
int asym_get_tick(asym_embed *e);

/* Read-only sim health dump (thinkers / possess pool / pause gates). */
#define ASYM_DEBUG_SAMPLE 8
typedef struct asym_debug_sample {
    uint32_t id;
    int type;
    int health;
    int controller;
    int tics;
} asym_debug_sample;

typedef struct asym_debug_sim {
    int gametic;
    int leveltime;
    int gamestate;
    int paused;
    int menuactive;
    int created;
    int rules_live;
    int playeringame0;
    int player_health;
    int player_mo_health;
    int thinker_total;
    int thinker_mobj;
    int thinker_door;
    int thinker_pending_free;
    int living_countkill;
    int possessable;
    int controller_neg1;
    int controller_ge0;
    int controller_orphan; /* >=0 but no live session slot */
    int sample_count;
    asym_debug_sample samples[ASYM_DEBUG_SAMPLE];
} asym_debug_sim;

void asym_debug_sim_get(asym_embed *e, asym_debug_sim *out);

/* sizeof guards for FFI */
size_t asym_sizeof_actor(void);
size_t asym_sizeof_snapshot(void);
size_t asym_sizeof_event(void);
size_t asym_sizeof_debug_sim(void);

/* Test helper: route through S_StartSound (NULL origin) for capture checks. */
void asym_test_start_sound(int sfx_id);

#ifdef __cplusplus
}
#endif

#endif /* ASYM_EMBED_H */
