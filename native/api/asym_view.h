/*
 * asym_view.h — Client-side WASM viewer API (not the authoritative sim).
 * Boots doomgeneric, loads a map, applies protocol movers/actors, and
 * renders via R_RenderPlayerView into DG_ScreenBuffer (RGBA).
 */
#ifndef ASYM_VIEW_H
#define ASYM_VIEW_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ASYM_VIEW_MAX_MOVERS 128
#define ASYM_VIEW_MAX_ACTORS 512
#define ASYM_VIEW_MAX_PROJECTILES 256
#define ASYM_VIEW_MAX_SWITCHES 50

typedef struct asym_view_mover {
    int id;
    float floor;
    float ceiling;
    float x, y;
} asym_view_mover;

typedef struct asym_view_door {
    int id;
    float position; /* ceiling height */
    float x, y;
} asym_view_door;

typedef struct asym_view_actor {
    uint32_t id;
    int type; /* mobjtype_t */
    float x, y, z;
    float angle; /* degrees */
    int sprite;
    int frame;
    int flags;
    int health;
} asym_view_actor;

typedef struct asym_view_projectile {
    uint32_t id;
    int type;
    float x, y, z;
    float angle;
    int sprite;
    int frame;
} asym_view_projectile;

typedef struct asym_view_switch {
    int id;  /* linedef index */
    int top;
    int mid;
    int bot;
} asym_view_switch;

/** Boot engine with IWAD already present at iwad_path (e.g. MEMFS "/doom1.wad").
 *  Returns 0 on success. Idempotent if already created. */
int asym_view_create(const char *iwad_path);

/** Load episode/map (1-based). Returns 0 on success. */
int asym_view_load_map(int episode, int map);

/** Protocol tick → leveltime/gametic (animated flats / lights). */
void asym_view_set_tick(int tick);

/** Camera pose: x/y map units, z = feet (eye computed from viewer sector), angle degrees. */
void asym_view_set_view(float x, float y, float z, float angle_deg);

/** When non-zero, skip R_DrawPlayerSprites (demon/spectator; marine HUD is TS). */
void asym_view_set_hide_psprites(int hide);

void asym_view_apply_doors(const asym_view_door *doors, int count);
void asym_view_apply_movers(const asym_view_mover *movers, int count);
/** Apply current switch textures; restores WAD originals for unlisted lines. */
void asym_view_apply_switches(const asym_view_switch *sw, int count);

/** Replace protocol-driven mobjs; map THINGS decorations stay from setup. */
void asym_view_sync_actors(const asym_view_actor *actors, int count, uint32_t hide_id);
void asym_view_sync_projectiles(const asym_view_projectile *projs, int count);

/** Render one frame into DG_ScreenBuffer. Returns 0 on success.
 *  scale: legacy fb_scaling request; each binary renders at its
 *  compile-time SCREENWIDTH×SCREENHEIGHT, so pass 0. */
int asym_view_render(int scale);

/** Legacy fb_scaling pixel-doubling. Render scale is now a true
 *  per-binary resolution; this clamps to the binary's max (1). */
void asym_view_set_scaling(int scale);

/** RGBA8888 framebuffer pointer (DG_ScreenBuffer). Packed used size is width×height;
 *  storage stride is fb_width (DOOMGENERIC_RESX). Image is top-aligned, x-centered. */
uint8_t *asym_view_framebuffer(void);
int asym_view_width(void);
int asym_view_height(void);
int asym_view_fb_width(void);
int asym_view_fb_height(void);

void asym_view_destroy(void);

#ifdef __cplusplus
}
#endif

#endif /* ASYM_VIEW_H */
