#ifndef ASYM_CONTROL_H
#define ASYM_CONTROL_H

#include "asym_embed.h"
#include "d_ticcmd.h"
#include <stdint.h>

struct mobj_s;

#define ASYM_HOT_STACKS 8

typedef struct asym_hot {
    int hp_left;
    int tics_left;
} asym_hot;

typedef struct asym_controller {
    int used;
    char session_id[ASYM_SESSION_ID_LEN];
    int role; /* 1 marine 2 demon 3 spectator */
    uint32_t body_id;
    asym_input latch;
    int points;
    asym_mods mods;
    int cooldown;   /* attack cooldown tics */
    int hopcool;    /* voluntary hop cooldown */
    int hoptics;    /* death repossess delay */
    int spectating;
    int usedown;    /* edge-trigger use (doors / switches) */
    asym_hot hots[ASYM_HOT_STACKS]; /* stackable consume heal-over-time */
} asym_controller;

void asym_control_init(void);
int asym_control_alloc(const char *session_id);
void asym_control_free(int slot);
asym_controller *asym_control_by_slot(int slot);
asym_controller *asym_control_by_session(const char *session_id);
int asym_control_slot_of(const char *session_id);

/* Apply latched intent for controlled demon bodies (call each tic). */
void asym_control_think_demons(void);
/* Fill marine ticcmd from latched intent (into the BuildTiccmd output). */
void asym_control_fill_marine_cmd(ticcmd_t *cmd);

#endif
