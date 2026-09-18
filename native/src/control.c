#include "control.h"
#include "actors.h"
#include "asym_rules.h"

#include "doomdef.h"
#include "doomstat.h"
#include "d_event.h"
#include "d_player.h"
#include "d_ticcmd.h"
#include "p_local.h"
#include "p_mobj.h"
#include "m_fixed.h"
#include "tables.h"
#include "info.h"
#include "sounds.h"
#include "s_sound.h"
#include "m_random.h"

#include <stdio.h>
#include <string.h>

void P_XYMovement(mobj_t *mo);

static asym_controller g_ctrl[ASYM_MAX_SESSIONS];

void asym_control_init(void)
{
    memset(g_ctrl, 0, sizeof(g_ctrl));
}

int asym_control_alloc(const char *session_id)
{
    int i;
    if (!session_id || !session_id[0]) return -1;
    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        if (g_ctrl[i].used && strcmp(g_ctrl[i].session_id, session_id) == 0)
            return i;
    }
    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        if (!g_ctrl[i].used) {
            memset(&g_ctrl[i], 0, sizeof(g_ctrl[i]));
            g_ctrl[i].used = 1;
            strncpy(g_ctrl[i].session_id, session_id, ASYM_SESSION_ID_LEN - 1);
            g_ctrl[i].role = 3; /* spectator until assigned */
            g_ctrl[i].body_id = 0;
            return i;
        }
    }
    return -1;
}

void asym_control_free(int slot)
{
    mobj_t *mo;
    if (slot < 0 || slot >= ASYM_MAX_SESSIONS) return;
    if (g_ctrl[slot].body_id) {
        mo = asym_actors_find(g_ctrl[slot].body_id);
        if (mo && mo->asym_controller == slot) {
            mo->asym_controller = -1;
            mo->player = NULL;
        }
    }
    memset(&g_ctrl[slot], 0, sizeof(g_ctrl[slot]));
}

asym_controller *asym_control_by_slot(int slot)
{
    if (slot < 0 || slot >= ASYM_MAX_SESSIONS) return NULL;
    if (!g_ctrl[slot].used) return NULL;
    return &g_ctrl[slot];
}

asym_controller *asym_control_by_session(const char *session_id)
{
    int s = asym_control_slot_of(session_id);
    return asym_control_by_slot(s);
}

int asym_control_slot_of(const char *session_id)
{
    int i;
    if (!session_id) return -1;
    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        if (g_ctrl[i].used && strcmp(g_ctrl[i].session_id, session_id) == 0)
            return i;
    }
    return -1;
}

static void thrust_mobj(mobj_t *mo, angle_t angle, fixed_t move)
{
    angle >>= ANGLETOFINESHIFT;
    mo->momx += FixedMul(move, finecosine[angle]);
    mo->momy += FixedMul(move, finesine[angle]);
}

static void demon_move(asym_controller *c, mobj_t *mo)
{
    asym_input *in = &c->latch;
    boolean flying = (mo->flags & MF_NOGRAVITY) != 0;
    boolean grounded = mo->z <= mo->floorz + FRACUNIT;
    int scale = asym_rules_move_scale(c, mo);
    int fwd = in->forward;
    int side = in->strafe;

    /* Host may pass protocol-normalized [-1,1] or already-scaled ticcmd units. */
    if (fwd != 0 && fwd >= -1 && fwd <= 1) {
        fwd = (fwd > 0 ? 1 : -1) * (in->run ? 50 : 25);
    }
    if (side != 0 && side >= -1 && side <= 1) {
        side = (side > 0 ? 1 : -1) * (in->run ? 40 : 24);
    } else if (in->run) {
        if (side > 0 && side < 40) side = 40;
        else if (side < 0 && side > -40) side = -40;
    }

    mo->angle += ((angle_t)in->turn_delta << 16);

    /* Thrust only — P_MobjThinker applies P_XYMovement once this tic.
       Calling it here as well double-applied momentum (~2× speed). */
    if (fwd) thrust_mobj(mo, mo->angle, fwd * scale);
    if (side) thrust_mobj(mo, mo->angle - ANG90, side * scale);
    (void)grounded;

    if (flying) {
        if (in->look_fly == 1) mo->momz += 2 * FRACUNIT;
        else if (in->look_fly == 2) mo->momz -= 2 * FRACUNIT;
        else if (!(mo->flags & MF_SKULLFLY)) mo->momz = FixedMul(mo->momz, 0xe000);
        if (mo->momz > 6 * FRACUNIT) mo->momz = 6 * FRACUNIT;
        if (mo->momz < -6 * FRACUNIT) mo->momz = -6 * FRACUNIT;
    }
}

/* Probe USERANGE ahead for a special line (doors/switches) without activating. */
static int g_probe_special;

static boolean PTR_ProbeSpecialTraverse(intercept_t *in)
{
    if (!in->d.line->special) {
        P_LineOpening(in->d.line);
        if (openrange <= 0)
            return false; /* solid wall — stop looking for specials */
        return true;
    }
    g_probe_special = 1;
    return false;
}

static int demon_special_ahead(mobj_t *mo)
{
    int angle;
    fixed_t x1, y1, x2, y2;

    g_probe_special = 0;
    angle = mo->angle >> ANGLETOFINESHIFT;
    x1 = mo->x;
    y1 = mo->y;
    x2 = x1 + (USERANGE >> FRACBITS) * finecosine[angle];
    y2 = y1 + (USERANGE >> FRACBITS) * finesine[angle];
    P_PathTraverse(x1, y1, x2, y2, PT_ADDLINES, PTR_ProbeSpecialTraverse);
    return g_probe_special;
}

static void demon_use(int slot, asym_controller *c, mobj_t *mo)
{
    player_t dummy;
    player_t *oldp;

    if (!c->latch.use) {
        c->usedown = 0;
        return;
    }
    if (c->usedown) return;
    c->usedown = 1;

    /* Doors/switches win when a special is ahead; else consume nearest corpse. */
    if (!demon_special_ahead(mo)) {
        if (asym_rules_try_consume(slot, mo))
            return;
    }

    /* P_UseLines needs a player_t; dummy.player makes switches/doors legal. */
    memset(&dummy, 0, sizeof(dummy));
    dummy.mo = mo;
    oldp = mo->player;
    mo->player = &dummy;
    P_UseLines(&dummy);
    mo->player = oldp;
}

static void demon_hitscan(mobj_t *mo, int pellets, int damage_mul, int sfx)
{
    angle_t an;
    fixed_t slope;
    int i, damage;
    if (sfx) S_StartSound(mo, sfx);
    an = mo->angle;
    slope = P_AimLineAttack(mo, an, MISSILERANGE);
    for (i = 0; i < pellets; i++) {
        angle_t shot = an + ((P_Random() - P_Random()) << 20);
        damage = ((P_Random() % 5) + 1) * damage_mul;
        P_LineAttack(mo, shot, MISSILERANGE, slope, damage);
    }
}

static void demon_attack(asym_controller *c, mobj_t *mo)
{
    if (c->cooldown > 0) return;
    if (!c->latch.fire) return;

    if (mo->info->meleestate && asym_rules_melee_target(mo)) {
        mobj_t *victim;
        int damage;
        if (mo->info->attacksound) S_StartSound(mo, mo->info->attacksound);
        P_SetMobjState(mo, mo->info->meleestate);
        /* A_*Attack is skipped while possessed — apply melee now. */
        victim = players[consoleplayer].mo;
        if (victim) {
            switch (mo->type) {
            case MT_SERGEANT:
            case MT_SHADOWS:
                damage = ((P_Random() % 10) + 1) * 4;
                break;
            case MT_HEAD:
                damage = (P_Random() % 6 + 1) * 10;
                break;
            case MT_BRUISER:
                damage = (P_Random() % 8 + 1) * 10;
                break;
            default:
                damage = (P_Random() % 8 + 1) * 3;
                break;
            }
            P_DamageMobj(victim, mo, mo, damage);
        }
        c->cooldown = asym_rules_attack_cooldown(c, mo);
        return;
    }

    /* Attack frames are visual only. Vanilla A_FaceTarget/A_TroopAttack would
       snap angle toward actor->target and spawn a second fireball. */
    mo->target = NULL;
    if (mo->info->missilestate)
        P_SetMobjState(mo, mo->info->missilestate);
    else if (mo->info->meleestate)
        P_SetMobjState(mo, mo->info->meleestate);

    switch (mo->type) {
    case MT_TROOP:
        P_SpawnPlayerMissile(mo, MT_TROOPSHOT);
        break;
    case MT_HEAD:
        P_SpawnPlayerMissile(mo, MT_HEADSHOT);
        break;
    case MT_BRUISER:
        P_SpawnPlayerMissile(mo, MT_BRUISERSHOT);
        break;
    case MT_POSSESSED:
        demon_hitscan(mo, 1, 3, sfx_pistol);
        break;
    case MT_SHOTGUY:
        demon_hitscan(mo, 3, 3, sfx_shotgn);
        break;
    case MT_SKULL:
        mo->flags |= MF_SKULLFLY;
        S_StartSound(mo, mo->info->attacksound);
        {
            angle_t an = mo->angle >> ANGLETOFINESHIFT;
            fixed_t speed = mo->info->speed;
            mo->momx = FixedMul(speed, finecosine[an]);
            mo->momy = FixedMul(speed, finesine[an]);
            mo->momz = 0;
        }
        break;
    default:
        break;
    }

    c->cooldown = asym_rules_attack_cooldown(c, mo);
}

void asym_control_think_demons(void)
{
    int i;
    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        asym_controller *c = &g_ctrl[i];
        mobj_t *mo;
        if (!c->used || c->role != 2) continue;

        if (c->hopcool > 0) c->hopcool--;
        if (c->cooldown > 0) c->cooldown--;
        if (c->hoptics > 0) {
            c->hoptics--;
            if (c->hoptics == 0) {
                asym_rules_possess_auto(i, 1 /* refill */);
            }
            continue;
        }

        if (!c->body_id) continue;
        mo = asym_actors_find(c->body_id);
        if (!mo || mo->health <= 0) {
            asym_rules_on_demon_death(i);
            continue;
        }

        /* Drop AI target so FLOAT hover / unguarded FaceTarget can't yank pose. */
        mo->target = NULL;

        /* arti: hop / buy */
        if (c->latch.arti == 5) {
            asym_rules_voluntary_hop(i);
            c->latch.arti = 0;
        } else if (c->latch.arti >= 1 && c->latch.arti <= 4) {
            asym_rules_try_buy(i, c->latch.arti - 1);
            c->latch.arti = 0;
        }

        demon_move(c, mo);
        demon_attack(c, mo);
        demon_use(i, c, mo);

        /* survival trickle + consume HoT */
        asym_rules_survival_tick(i);
        asym_rules_heal_tick(i);
    }
}

/* Debug helper for tests */
int asym_control_debug_latch_forward(const char *session_id)
{
    asym_controller *c = asym_control_by_session(session_id);
    return c ? c->latch.forward : -999;
}

int asym_control_debug_role(const char *session_id)
{
    asym_controller *c = asym_control_by_session(session_id);
    return c ? c->role : -999;
}

/* arti 1–8: select weapon (vanilla keys); 9 next; 10 prev. */
#define ARTI_WEAPON_NEXT 9
#define ARTI_WEAPON_PREV 10

static const struct {
    weapontype_t weapon;
    weapontype_t weapon_num;
} marine_weapon_order[] = {
    { wp_fist,            wp_fist },
    { wp_chainsaw,        wp_fist },
    { wp_pistol,          wp_pistol },
    { wp_shotgun,         wp_shotgun },
    { wp_supershotgun,    wp_shotgun },
    { wp_chaingun,        wp_chaingun },
    { wp_missile,         wp_missile },
    { wp_plasma,          wp_plasma },
    { wp_bfg,             wp_bfg },
};

static boolean marine_weapon_selectable(weapontype_t weapon)
{
    if (weapon == wp_supershotgun && logical_gamemission == doom)
        return false;
    if ((weapon == wp_plasma || weapon == wp_bfg)
        && gamemission == doom && gamemode == shareware)
        return false;
    if (!players[consoleplayer].weaponowned[weapon])
        return false;
    if (weapon == wp_fist
        && players[consoleplayer].weaponowned[wp_chainsaw]
        && !players[consoleplayer].powers[pw_strength])
        return false;
    return true;
}

static int marine_next_weapon(int direction)
{
    weapontype_t weapon;
    int start_i, i;
    int n = (int)arrlen(marine_weapon_order);

    if (players[consoleplayer].pendingweapon == wp_nochange)
        weapon = players[consoleplayer].readyweapon;
    else
        weapon = players[consoleplayer].pendingweapon;

    for (i = 0; i < n; i++) {
        if (marine_weapon_order[i].weapon == weapon)
            break;
    }
    if (i >= n) i = 0;
    start_i = i;
    do {
        i += direction;
        i = (i + n) % n;
    } while (i != start_i && !marine_weapon_selectable(marine_weapon_order[i].weapon));
    return marine_weapon_order[i].weapon_num;
}

static void marine_apply_weapon(ticcmd_t *cmd, asym_controller *marine)
{
    int arti = marine->latch.arti;
    int wnum = -1;

    if (arti >= 1 && arti <= 8)
        wnum = arti - 1;
    else if (arti == ARTI_WEAPON_NEXT)
        wnum = marine_next_weapon(1);
    else if (arti == ARTI_WEAPON_PREV)
        wnum = marine_next_weapon(-1);

    if (wnum < 0) return;
    cmd->buttons |= BT_CHANGE;
    cmd->buttons |= (wnum << BT_WEAPONSHIFT) & BT_WEAPONMASK;
    marine->latch.arti = 0;
}

void asym_control_fill_marine_cmd(ticcmd_t *cmd)
{
    int i;
    asym_controller *marine = NULL;
    if (!cmd) return;

    for (i = 0; i < ASYM_MAX_SESSIONS; i++) {
        if (g_ctrl[i].used && g_ctrl[i].role == 1) {
            marine = &g_ctrl[i];
            break;
        }
    }
    memset(cmd, 0, sizeof(*cmd));
    if (!marine) return;

    {
        int fwd = marine->latch.forward;
        int side = marine->latch.strafe;
        if (fwd != 0 && fwd >= -1 && fwd <= 1) {
            fwd = (fwd > 0 ? 1 : -1) * (marine->latch.run ? 50 : 25);
        }
        if (side != 0 && side >= -1 && side <= 1) {
            side = (side > 0 ? 1 : -1) * (marine->latch.run ? 40 : 24);
        }
        cmd->forwardmove = (signed char)fwd;
        cmd->sidemove = (signed char)side;
    }
    cmd->angleturn = (short)marine->latch.turn_delta;
    if (marine->latch.fire) cmd->buttons |= BT_ATTACK;
    if (marine->latch.use) cmd->buttons |= BT_USE;
    marine_apply_weapon(cmd, marine);
}
