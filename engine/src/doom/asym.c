//
// asymDOOM: asymmetrical multiplayer rules.
//
// Everything in this file runs identically on every lockstep peer. The only
// non-deterministic things allowed are stdout HUD messages, and those are
// emitted for the local console player only.
//

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "asym.h"

#include "doomstat.h"
#include "d_player.h"
#include "g_game.h"
#include "hu_stuff.h"
#include "i_system.h"
#include "info.h"
#include "m_argv.h"
#include "m_random.h"
#include "p_local.h"
#include "r_main.h"
#include "doomdata.h"
#include "s_sound.h"
#include "sounds.h"
#include "st_stuff.h"
#include "tables.h"

// p_user.c / p_spec.c / p_mobj.c helpers without public prototypes
void P_Thrust(player_t *player, angle_t angle, fixed_t move);
void P_PlayerInSpecialSector(player_t *player);
void P_CheckMissileSpawn(mobj_t *th);

extern gameaction_t gameaction;

boolean asym_mode = false;
asym_settings_t asym_settings = {
    ASYM_MARINE_DEATH_DEMONS_WIN,
    ASYM_DEMON_DEATH_POSSESS_NEXT,
    ASYM_P_DEFAULT,
    ASYM_DEMON_VIEW_FIRST_PERSON,
};

unsigned int asym_spawn_counter = 0;

// Non-zero while the demons-win countdown runs; fires ga_victory at zero.
static int asym_win_countdown = 0;
static boolean asym_demons_won = false;

// ---------------------------------------------------------------------------
// Species table (shareware roster)
// ---------------------------------------------------------------------------

typedef struct {
    mobjtype_t type;
    const char *name;
    int mask_bit;
    int attack_cooldown; // tics between player-triggered attacks
    int move_scale;      // thrust per unit of forwardmove (marine is 2048)
} asym_species_t;

static const asym_species_t species_table[] = {
    {MT_POSSESSED, "zombieman",  ASYM_P_ZOMBIEMAN,  28, 1900},
    {MT_SHOTGUY,   "shotgunner", ASYM_P_SHOTGUNNER, 42, 1900},
    {MT_TROOP,     "imp",        ASYM_P_IMP,        30, 2000},
    {MT_SERGEANT,  "demon",      ASYM_P_DEMON,      22, 2400},
    {MT_SHADOWS,   "spectre",    ASYM_P_SPECTRE,    22, 2400},
    {MT_SKULL,     "lostsoul",   ASYM_P_LOSTSOUL,   40, 2100},
    {MT_HEAD,      "cacodemon",  ASYM_P_CACODEMON,  38, 1900},
    {MT_BRUISER,   "baron",      ASYM_P_BARON,      48, 1700},
};

static const asym_species_t *SpeciesFor(mobjtype_t type)
{
    size_t i;
    for (i = 0; i < arrlen(species_table); ++i) {
        if (species_table[i].type == type) return &species_table[i];
    }
    return NULL;
}

const char *ASYM_SpeciesName(mobjtype_t type)
{
    const asym_species_t *s = SpeciesFor(type);
    return s ? s->name : "monster";
}

// ---------------------------------------------------------------------------
// Settings plumbing
// ---------------------------------------------------------------------------

void ASYM_InitFromArgs(void)
{
    int i;

    //!
    // @category asym
    // @arg <n>
    //
    // Rule applied when the marine dies (0=demons win).
    //
    i = M_CheckParmWithArgs("-asymmarinedeath", 1);
    if (i > 0) asym_settings.marine_death = atoi(myargv[i + 1]);

    //!
    // @category asym
    // @arg <n>
    //
    // Rule applied when a possessed demon dies (0=possess next).
    //
    i = M_CheckParmWithArgs("-asymdemondeath", 1);
    if (i > 0) asym_settings.demon_death = atoi(myargv[i + 1]);

    //!
    // @category asym
    // @arg <n>
    //
    // Bitmask of possessable species.
    //
    i = M_CheckParmWithArgs("-asymmask", 1);
    if (i > 0) asym_settings.possess_mask = atoi(myargv[i + 1]);

    //!
    // @category asym
    // @arg <n>
    //
    // Possessed demon camera (0=first person, 1=chase).
    //
    i = M_CheckParmWithArgs("-asymdemonview", 1);
    if (i > 0) asym_settings.demon_view = atoi(myargv[i + 1]);
}

void ASYM_SaveSettings(net_gamesettings_t *settings)
{
    settings->asym_marine_death = asym_settings.marine_death;
    settings->asym_demon_death = asym_settings.demon_death;
    settings->asym_possess_mask = asym_settings.possess_mask;
    settings->asym_demon_view = asym_settings.demon_view;
    settings->asym_join_tic = 0;
}

void ASYM_LoadSettings(net_gamesettings_t *settings)
{
    asym_settings.marine_death = settings->asym_marine_death;
    asym_settings.demon_death = settings->asym_demon_death;
    asym_settings.possess_mask = settings->asym_possess_mask;
    asym_settings.demon_view = settings->asym_demon_view;
}

// ---------------------------------------------------------------------------
// Local HUD output (stdout protocol; presentation only)
// ---------------------------------------------------------------------------

static boolean IsLocal(player_t *p) { return p == &players[consoleplayer]; }

void ASYM_EmitRole(void)
{
    if (!asym_mode) return;
    if (consoleplayer == 0)
        printf("asym: role marine\n");
    else if (players[consoleplayer].mo != NULL)
        printf("asym: role demon\n");
    else
        printf("asym: role spectator\n");
}

static void EmitBody(player_t *p)
{
    if (!IsLocal(p) || p->mo == NULL) return;
    printf("asym: body %s hp %d maxhp %d\n", ASYM_SpeciesName(p->mo->type), p->mo->health,
           p->mo->info->spawnhealth * (100 + 25 * p->asym_mods[ASYM_MOD_HEALTH]) / 100);
}

static void EmitPoints(player_t *p)
{
    if (!IsLocal(p)) return;
    printf("asym: points %d mods %d %d %d %d\n", p->asym_points, p->asym_mods[0], p->asym_mods[1], p->asym_mods[2],
           p->asym_mods[3]);
}

// ---------------------------------------------------------------------------
// Possession
// ---------------------------------------------------------------------------

boolean ASYM_IsPossessed(mobj_t *mo) { return mo != NULL && mo->player != NULL && mo->type != MT_PLAYER; }

boolean ASYM_IsPossessable(mobj_t *mo)
{
    const asym_species_t *s;

    if (mo->health <= 0) return false;
    if (mo->player != NULL) return false;
    if (mo->flags & MF_CORPSE) return false;

    s = SpeciesFor(mo->type);
    if (s == NULL) return false;

    return (asym_settings.possess_mask & s->mask_bit) != 0;
}

// Deterministic pick: living possessable monster with the lowest spawn id.
static mobj_t *FindBody(void)
{
    thinker_t *th;
    mobj_t *mo;
    mobj_t *best = NULL;

    for (th = thinkercap.next; th != &thinkercap; th = th->next) {
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t *)th;
        if (!ASYM_IsPossessable(mo)) continue;
        if (best == NULL || mo->asym_id < best->asym_id) best = mo;
    }

    return best;
}

static boolean Possess(int pnum)
{
    player_t *p = &players[pnum];
    mobj_t *body = FindBody();

    if (body == NULL) return false;

    body->player = p;
    body->target = NULL;
    body->flags &= ~MF_AMBUSH;

    // Fresh body arrives at (modified) full health.
    body->health = body->info->spawnhealth * (100 + 25 * p->asym_mods[ASYM_MOD_HEALTH]) / 100;

    p->mo = body;
    p->playerstate = PST_LIVE;
    p->health = body->health;
    p->asym_cooldown = 0;
    p->asym_hoptics = 0;
    p->asym_spectating = false;
    p->viewheight = body->height - (body->height >> 2);
    p->viewz = body->z + p->viewheight;
    p->attacker = NULL;
    p->damagecount = 0;
    p->bonuscount = 0;
    p->extralight = 0;
    p->fixedcolormap = 0;

    if (body->info->seesound) S_StartSound(body, body->info->seesound);

    if (IsLocal(p)) {
        printf("asym: hop %s\n", ASYM_SpeciesName(body->type));
        EmitBody(p);
        EmitPoints(p);
    }

    return true;
}

static void ResetDemonPlayer(int pnum)
{
    player_t *p = &players[pnum];

    memset(p, 0, sizeof(*p));
    p->playerstate = PST_LIVE;
    p->health = 0;
}

void ASYM_LevelStart(void)
{
    int i;

    if (!asym_mode) return;

    asym_win_countdown = 0;
    asym_demons_won = false;

    for (i = 1; i < MAXPLAYERS; ++i) {
        player_t *p = &players[i];

        if (!playeringame[i]) continue;

        // Detach from any body pointer left over from the previous level
        // (level teardown freed all mobjs).
        p->mo = NULL;
        p->playerstate = PST_LIVE;
        p->asym_hoptics = 0;
        p->asym_spectating = false;

        if (!Possess(i) && IsLocal(p)) {
            printf("asym: spectate\n");
        }
    }

    // Demon clients never go through P_SpawnPlayer, which normally wakes
    // the status bar and HUD for the console player.
    if (consoleplayer != 0 && playeringame[consoleplayer]) {
        ST_Start();
        HU_Start();
    }

    ASYM_EmitRole();
}

void ASYM_PlayerJoin(int pnum)
{
    if (!asym_mode || pnum == 0) return;

    playeringame[pnum] = true;
    ResetDemonPlayer(pnum);

    if (gamestate == GS_LEVEL && !Possess(pnum)) {
        players[pnum].asym_spectating = true;
        players[pnum].asym_hoptics = TICRATE;
        if (IsLocal(&players[pnum])) printf("asym: spectate\n");
    }

    if (IsLocal(&players[pnum])) ASYM_EmitRole();
}

void ASYM_PlayerLeave(int pnum)
{
    player_t *p = &players[pnum];

    if (!asym_mode || pnum == 0) return;

    if (p->mo != NULL && p->mo->type != MT_PLAYER) {
        // Return the body to AI control; it resumes hunting the marine.
        p->mo->player = NULL;
        if (playeringame[0] && players[0].mo != NULL) p->mo->target = players[0].mo;
    }
    p->mo = NULL;
}

// ---------------------------------------------------------------------------
// Death rules
// ---------------------------------------------------------------------------

void ASYM_PossessedKilled(mobj_t *mo)
{
    player_t *p = mo->player;

    mo->player = NULL;
    p->mo = NULL;
    p->health = 0;

    // Rule enum stubbed for the future; v1 always hops (and hop falls back
    // to spectating when no bodies remain).
    switch ((asym_demon_death_t)asym_settings.demon_death) {
    case ASYM_DEMON_DEATH_POSSESS_NEXT:
    case ASYM_DEMON_DEATH_SPECTATE:
    case ASYM_DEMON_DEATH_SPAWN_NEW:
    default:
        p->asym_hoptics = TICRATE;
        break;
    }
}

void ASYM_MarineKilled(void)
{
    if (!asym_mode || asym_win_countdown > 0) return;

    // Rule enum stubbed for the future; v1 always ends the match.
    switch ((asym_marine_death_t)asym_settings.marine_death) {
    case ASYM_MARINE_DEATH_DEMONS_WIN:
    case ASYM_MARINE_DEATH_RESPAWN_AS_KILLER:
    case ASYM_MARINE_DEATH_RESPAWN:
    default:
        asym_demons_won = true;
        asym_win_countdown = 3 * TICRATE;
        printf("asym: win demons\n");
        break;
    }
}

boolean ASYM_DemonsWon(void) { return asym_demons_won; }

void ASYM_Ticker(void)
{
    if (!asym_mode) return;

    if (asym_win_countdown > 0) {
        if (--asym_win_countdown == 0) {
            gameaction = ga_victory;
        }
    }
}

// ---------------------------------------------------------------------------
// Demon player think
// ---------------------------------------------------------------------------

static int MoveScale(player_t *p, mobj_t *mo)
{
    const asym_species_t *s = SpeciesFor(mo->type);
    int scale = s ? s->move_scale : 1900;

    return scale * (100 + 15 * p->asym_mods[ASYM_MOD_SPEED]) / 100;
}

static int AttackCooldown(player_t *p, mobj_t *mo)
{
    const asym_species_t *s = SpeciesFor(mo->type);
    int base = s ? s->attack_cooldown : 35;

    return base * 100 / (100 + 20 * p->asym_mods[ASYM_MOD_RATE]);
}

mobj_t *ASYM_MeleeTarget(mobj_t *actor)
{
    P_AimLineAttack(actor, actor->angle, MELEERANGE);
    return linetarget;
}

// Angle-based monster missile (modeled on P_SpawnPlayerMissile).
void ASYM_SpawnMissile(mobj_t *source, mobjtype_t type)
{
    mobj_t *th;
    angle_t an;
    fixed_t slope;

    an = source->angle;
    slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);

    if (!linetarget) {
        an += 1 << 26;
        slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);

        if (!linetarget) {
            an -= 2 << 26;
            slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);
        }

        if (!linetarget) {
            an = source->angle;
            slope = 0;
        }
    }

    th = P_SpawnMobj(source->x, source->y, source->z + 4 * 8 * FRACUNIT, type);

    if (th->info->seesound) S_StartSound(th, th->info->seesound);

    th->target = source;
    th->angle = an;
    th->momx = FixedMul(th->info->speed, finecosine[an >> ANGLETOFINESHIFT]);
    th->momy = FixedMul(th->info->speed, finesine[an >> ANGLETOFINESHIFT]);
    th->momz = FixedMul(th->info->speed, slope);

    P_CheckMissileSpawn(th);
}

static void StartAttack(player_t *p, mobj_t *mo)
{
    boolean started = false;

    if (mo->info->meleestate && ASYM_MeleeTarget(mo) != NULL) {
        if (mo->info->attacksound) S_StartSound(mo, mo->info->attacksound);
        P_SetMobjState(mo, mo->info->meleestate);
        started = true;
    }
    else if (mo->info->missilestate) {
        P_SetMobjState(mo, mo->info->missilestate);
        started = true;
    }
    else if (mo->info->meleestate) {
        // Swing at air.
        if (mo->info->attacksound) S_StartSound(mo, mo->info->attacksound);
        P_SetMobjState(mo, mo->info->meleestate);
        started = true;
    }

    if (started) {
        p->asym_cooldown = AttackCooldown(p, mo);
    }
}

static void DemonMove(player_t *p, mobj_t *mo)
{
    ticcmd_t *cmd = &p->cmd;
    boolean flying = (mo->flags & MF_NOGRAVITY) != 0;
    boolean grounded = mo->z <= mo->floorz;
    int scale = MoveScale(p, mo);

    mo->angle += (cmd->angleturn << FRACBITS);

    if (grounded || flying) {
        if (cmd->forwardmove) P_Thrust(p, mo->angle, cmd->forwardmove * scale);
        if (cmd->sidemove) P_Thrust(p, mo->angle - ANG90, cmd->sidemove * scale);
    }

    if (flying) {
        if (cmd->lookfly == 1) {
            mo->momz += 2 * FRACUNIT;
        }
        else if (cmd->lookfly == 2) {
            mo->momz -= 2 * FRACUNIT;
        }
        else if (!(mo->flags & MF_SKULLFLY)) {
            mo->momz = FixedMul(mo->momz, 0xe000);
        }

        if (mo->momz > 6 * FRACUNIT) mo->momz = 6 * FRACUNIT;
        if (mo->momz < -6 * FRACUNIT) mo->momz = -6 * FRACUNIT;
    }
}

void ASYM_PlayerThink(player_t *player)
{
    ticcmd_t *cmd = &player->cmd;
    mobj_t *mo = player->mo;
    int pnum = player - players;
    static int last_hp = -1;

    // A special event has no other buttons.
    if (cmd->buttons & BT_SPECIAL) cmd->buttons = 0;

    // --- No body: hopping or spectating ---
    if (mo == NULL) {
        if (player->asym_hoptics > 0) {
            player->asym_hoptics--;
            if (player->asym_hoptics == 0) {
                if (!Possess(pnum)) {
                    if (!player->asym_spectating && IsLocal(player)) printf("asym: spectate\n");
                    player->asym_spectating = true;
                    player->asym_hoptics = TICRATE; // keep retrying
                }
            }
        }
        if (player->damagecount) player->damagecount--;
        return;
    }

    // --- Body died out from under us (safety net) ---
    if (mo->health <= 0) {
        ASYM_PossessedKilled(mo);
        return;
    }

    if (mo->reactiontime) {
        mo->reactiontime--;
    }
    else {
        DemonMove(player, mo);
    }

    // Eye height: three quarters up the body.
    player->viewheight = mo->height - (mo->height >> 2);
    player->viewz = mo->z + player->viewheight;
    if (player->viewz > mo->ceilingz - 4 * FRACUNIT) player->viewz = mo->ceilingz - 4 * FRACUNIT;

    if (mo->subsector->sector->special) P_PlayerInSpecialSector(player);

    // Attack
    if (player->asym_cooldown > 0) player->asym_cooldown--;
    if ((cmd->buttons & BT_ATTACK) && player->asym_cooldown == 0 && !(mo->flags & MF_SKULLFLY)) {
        StartAttack(player, mo);
    }

    // Use (open doors, hit switches)
    if (cmd->buttons & BT_USE) {
        if (!player->usedown) {
            P_UseLines(player);
            player->usedown = true;
        }
    }
    else {
        player->usedown = false;
    }

    // Survival trickle: one point per five seconds possessed.
    if (leveltime > 0 && (leveltime % (5 * TICRATE)) == 0) {
        player->asym_points += 1;
        EmitPoints(player);
    }

    // Mirror body health for HUD/status bar.
    player->health = mo->health;

    if (IsLocal(player) && player->health != last_hp) {
        last_hp = player->health;
        EmitBody(player);
    }

    if (player->damagecount) player->damagecount--;
    if (player->bonuscount) player->bonuscount--;
    player->fixedcolormap = 0;
}

// ---------------------------------------------------------------------------
// Combat hooks
// ---------------------------------------------------------------------------

int ASYM_ScaleDamageFrom(mobj_t *source, int damage)
{
    if (!asym_mode || !ASYM_IsPossessed(source)) return damage;

    return damage * (100 + 25 * source->player->asym_mods[ASYM_MOD_DAMAGE]) / 100;
}

void ASYM_AwardDamage(mobj_t *source, mobj_t *target, int damage)
{
    player_t *p;

    if (!asym_mode || source == NULL || source == target) return;
    if (!ASYM_IsPossessed(source)) return;

    p = source->player;

    if (target->player == &players[0]) {
        p->asym_points += damage * 2; // hurting the marine is the job
    }
    else {
        p->asym_points += damage / 4; // collateral counts a little
    }

    EmitPoints(p);
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

void ASYM_TryBuy(player_t *player, int which)
{
    int idx = which - 1;

    if (!asym_mode || !ASYM_IsDemonSlot(player - players)) return;
    if (idx < 0 || idx >= ASYM_NUM_MODS) return;

    // Spend while between bodies (hop/spectate) or at intermission only.
    if (player->mo != NULL && gamestate != GS_INTERMISSION) {
        if (IsLocal(player)) printf("asym: buyfail alive\n");
        return;
    }

    if (player->asym_mods[idx] >= ASYM_MOD_MAXLEVEL) {
        if (IsLocal(player)) printf("asym: buyfail max\n");
        return;
    }

    if (player->asym_points < ASYM_MOD_COST) {
        if (IsLocal(player)) printf("asym: buyfail points\n");
        return;
    }

    player->asym_points -= ASYM_MOD_COST;
    player->asym_mods[idx]++;
    EmitPoints(player);
}

// ---------------------------------------------------------------------------
// Camera (presentation only; never touches sim state)
// ---------------------------------------------------------------------------

boolean ASYM_WantChaseCam(player_t *player)
{
    if (!asym_mode || player == NULL || player->mo == NULL) return false;
    if (player - players == 0) return false; // marine is always first person
    if (asym_settings.demon_view != ASYM_DEMON_VIEW_CHASE) return false;
    return true;
}

boolean ASYM_HidePsprites(player_t *player)
{
    if (!asym_mode || player == NULL) return false;
    // Marine keeps vanilla weapon overlays. Demons (and chase cam) never do.
    return ASYM_IsDemonSlot(player - players);
}

static fixed_t chase_frac;

static boolean PTR_ChaseTraverse(intercept_t *in)
{
    line_t *li;

    if (!in->isaline) return true;

    li = in->d.line;

    if (!(li->flags & ML_TWOSIDED) || (li->flags & ML_BLOCKING)) {
        if (in->frac < chase_frac) chase_frac = in->frac;
        return false;
    }

    P_LineOpening(li);
    if (openrange <= 0) {
        if (in->frac < chase_frac) chase_frac = in->frac;
        return false;
    }

    return true;
}

void ASYM_ApplyChaseCam(player_t *player)
{
    mobj_t *mo = player->mo;
    angle_t an;
    fixed_t dist;
    fixed_t x;
    fixed_t y;
    fixed_t z;

    if (mo == NULL) return;

    an = mo->angle + ANG180;
    dist = 96 * FRACUNIT;
    x = mo->x + FixedMul(dist, finecosine[an >> ANGLETOFINESHIFT]);
    y = mo->y + FixedMul(dist, finesine[an >> ANGLETOFINESHIFT]);
    z = player->viewz + 16 * FRACUNIT;

    chase_frac = FRACUNIT;
    P_PathTraverse(mo->x, mo->y, x, y, PT_ADDLINES, PTR_ChaseTraverse);

    // Pull in from the hit so the camera sits in open space, not in the wall.
    if (chase_frac < FRACUNIT) {
        if (chase_frac > 12 * FRACUNIT / 96)
            chase_frac -= 12 * FRACUNIT / 96;
        else
            chase_frac = 0;
        x = mo->x + FixedMul(FixedMul(dist, chase_frac), finecosine[an >> ANGLETOFINESHIFT]);
        y = mo->y + FixedMul(FixedMul(dist, chase_frac), finesine[an >> ANGLETOFINESHIFT]);
    }

    viewx = x;
    viewy = y;
    viewz = z;
    viewangle = mo->angle;
    viewsin = finesine[viewangle >> ANGLETOFINESHIFT];
    viewcos = finecosine[viewangle >> ANGLETOFINESHIFT];
}
