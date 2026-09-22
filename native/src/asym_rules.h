#ifndef ASYM_RULES_H
#define ASYM_RULES_H

#include "control.h"
#include "events/events.h"
#include <stdint.h>

struct mobj_s;

#define ASYM_P_DEFAULT 0xff
#define ASYM_CONSUME_KILL_POINTS 25
#define ASYM_CONSUME_DECO_POINTS 10
#define ASYM_CONSUME_HEAL_TOTAL 10
/* 5 seconds at 35 Hz — keep numeric so headers need no doomdef. */
#define ASYM_CONSUME_HEAL_TICS 175
/* Map units a body must be able to walk from spawn to count as mobile. */
#define ASYM_SPAWN_ESCAPE_MAPUNITS 128

#define ASYM_THRUST_BASE 1100

/* Upgrade kind order matches asym_mods / try_buy mod_index. */
typedef enum asym_upgrade_kind {
    ASYM_UPGRADE_HEALTH = 0,
    ASYM_UPGRADE_SPEED = 1,
    ASYM_UPGRADE_DAMAGE = 2,
    ASYM_UPGRADE_RATE = 3,
    ASYM_UPGRADE_COUNT = 4
} asym_upgrade_kind;

/* One rung on an upgrade ladder: points to buy this level, effect scalar. */
typedef struct asym_upgrade_level {
    int cost;
    int scalar; /* percent; 100 = baseline */
} asym_upgrade_level;

/* Per-type ladder so cost curves and effect curves stay independent. */
typedef struct asym_upgrade_table {
    const asym_upgrade_level *levels;
    int count; /* includes level 0 baseline */
} asym_upgrade_table;

typedef struct asym_rules_state {
    int marine_death;
    int possess_mask;
    int marine_slot; /* controller slot of marine, or -1 */
    int pending_marine_slot;
    int reload_episode; /* 0 → use embed cfg on round reload */
    int reload_map;
    int win_countdown;
    int want_round_reload;
    int need_round_reload;
    int demons_won;
    int map_ready;
    asym_event_queue *events; /* borrowed */
} asym_rules_state;

void asym_rules_init(asym_rules_state *st, int marine_death, int possess_mask, asym_event_queue *eq);
void asym_rules_on_level_start(asym_rules_state *st);
void asym_rules_ticker(asym_rules_state *st);

int asym_rules_is_possessable(struct mobj_s *mo);
/* 1 if mo is owned by a live session; heals orphan controller slots to -1. */
int asym_rules_controller_active(struct mobj_s *mo);
const char *asym_rules_species_name(int mobjtype);
int asym_rules_move_scale(asym_controller *c, struct mobj_s *mo);
int asym_rules_attack_cooldown(asym_controller *c, struct mobj_s *mo);
struct mobj_s *asym_rules_melee_target(struct mobj_s *mo);

/* Floor body/gib map decorations (MT_MISC61–69, 71, 84–86). */
int asym_rules_is_consumable_deco(int mobjtype);

int asym_rules_possess(int slot, uint32_t body_id, int refill);
int asym_rules_possess_auto(int slot, int refill);
void asym_rules_release(int slot);
void asym_rules_voluntary_hop(int slot);
void asym_rules_on_demon_death(int slot);
void asym_rules_on_marine_death(int killer_slot);
/* Sector special 9 — secret discovered. sector_index is sectors[] offset. */
void asym_rules_on_secret(int sector_index, int secret_count);
void asym_rules_try_buy(int slot, int mod_index);
void asym_rules_survival_tick(int slot);
/* Apply stackable consume HoT while possessing a living body. */
void asym_rules_heal_tick(int slot);
/* Nearest edible (kill corpse or gore deco) in USERANGE. Returns 1 if eaten. */
int asym_rules_try_consume(int slot, struct mobj_s *mo);

int asym_rules_scale_damage(struct mobj_s *source, int damage);
void asym_rules_award_damage(struct mobj_s *source, struct mobj_s *target, int damage);

/* set from embed */
extern asym_rules_state *g_asym_rules;

#endif
