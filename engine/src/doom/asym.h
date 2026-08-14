//
// asymDOOM: asymmetrical multiplayer rules.
//
// Player slot 0 is always the marine. Every other player slot possesses a
// living map monster ("demon"). All of this code runs inside the
// deterministic lockstep simulation, so every decision here must depend only
// on sim state and net-transmitted settings.
//

#ifndef __ASYM__
#define __ASYM__

#include "doomtype.h"
#include "d_player.h"
#include "net_defs.h"
#include "p_mobj.h"

// ---------------------------------------------------------------------------
// Rule settings (net-transmitted inside net_gamesettings_t)
// ---------------------------------------------------------------------------

typedef enum {
    ASYM_MARINE_DEATH_DEMONS_WIN = 0,
    ASYM_MARINE_DEATH_RESPAWN_AS_KILLER = 1, // future
    ASYM_MARINE_DEATH_RESPAWN = 2,           // future
} asym_marine_death_t;

typedef enum {
    ASYM_DEMON_DEATH_POSSESS_NEXT = 0,
    ASYM_DEMON_DEATH_SPECTATE = 1,  // future
    ASYM_DEMON_DEATH_SPAWN_NEW = 2, // future
} asym_demon_death_t;

// Possessed-demon camera. The marine is always first person; this setting
// never applies to slot 0 or to spectators watching the marine.
typedef enum {
    ASYM_DEMON_VIEW_FIRST_PERSON = 0,
    ASYM_DEMON_VIEW_CHASE = 1,
} asym_demon_view_t;

typedef struct {
    int marine_death; // asym_marine_death_t
    int demon_death;  // asym_demon_death_t
    int possess_mask; // ASYM_P_* bits
    int demon_view;   // asym_demon_view_t (presentation only)
} asym_settings_t;

// Possessable species bits (shareware roster). Must match the gateway's
// settings.json encoding.
#define ASYM_P_ZOMBIEMAN  (1 << 0)
#define ASYM_P_SHOTGUNNER (1 << 1)
#define ASYM_P_IMP        (1 << 2)
#define ASYM_P_DEMON      (1 << 3)
#define ASYM_P_SPECTRE    (1 << 4)
#define ASYM_P_LOSTSOUL   (1 << 5)
#define ASYM_P_CACODEMON  (1 << 6)
#define ASYM_P_BARON      (1 << 7)
#define ASYM_P_DEFAULT    0xff

// Modifier kinds (index into player_t::asym_mods)
enum {
    ASYM_MOD_HEALTH = 0,
    ASYM_MOD_SPEED,
    ASYM_MOD_DAMAGE,
    ASYM_MOD_RATE,
    ASYM_NUM_MODS,
};

#define ASYM_MOD_COST 50
#define ASYM_MOD_MAXLEVEL 4

extern boolean asym_mode;
extern asym_settings_t asym_settings;

// Deterministic spawn counter (reset each level; assigned in P_SpawnMobj).
extern unsigned int asym_spawn_counter;

// Settings plumbing
void ASYM_InitFromArgs(void);
void ASYM_SaveSettings(net_gamesettings_t *settings);
void ASYM_LoadSettings(net_gamesettings_t *settings);

// Role/possession queries
#define ASYM_IsDemonSlot(pnum) ((pnum) != 0)
boolean ASYM_IsPossessed(mobj_t *mo);      // player-driven monster body
boolean ASYM_IsPossessable(mobj_t *mo);    // valid possession target now
const char *ASYM_SpeciesName(mobjtype_t type);

// Lifecycle hooks
void ASYM_LevelStart(void);              // after P_SetupLevel: bind bodies
void ASYM_PlayerJoin(int pnum);          // player appears mid-game (join tic)
void ASYM_PlayerLeave(int pnum);         // player slot quit: release body
void ASYM_Ticker(void);                  // per-tic (GS_LEVEL): win countdown
void ASYM_PlayerThink(player_t *player); // demon/spectator think
void ASYM_PossessedKilled(mobj_t *mo);   // possessed body died
void ASYM_MarineKilled(void);            // marine died
boolean ASYM_DemonsWon(void);

// Combat hooks
int ASYM_ScaleDamageFrom(mobj_t *source, int damage);
void ASYM_AwardDamage(mobj_t *source, mobj_t *target, int damage);
mobj_t *ASYM_MeleeTarget(mobj_t *actor); // aim-based melee victim (possessed)
void ASYM_SpawnMissile(mobj_t *source, mobjtype_t type); // angle-based

// Economy (deterministic: rides the ticcmd arti field)
void ASYM_TryBuy(player_t *player, int which);

// Local-presentation helpers (no sim effects)
void ASYM_EmitRole(void);
boolean ASYM_WantChaseCam(player_t *player);
void ASYM_ApplyChaseCam(player_t *player);
boolean ASYM_HidePsprites(player_t *player);

#endif
