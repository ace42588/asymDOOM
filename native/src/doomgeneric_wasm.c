/*
 * doomgeneric_wasm.c — Headless platform for the client WASM viewer.
 * No SDL window/audio; DG_DrawFrame is a no-op (JS reads DG_ScreenBuffer).
 */
#include "doomkeys.h"
#include "m_argv.h"
#include "doomgeneric.h"

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

pixel_t *DG_ScreenBuffer = NULL;

static uint32_t s_host_ms = 0;

void M_FindResponseFile(void);
void D_DoomMain(void);

void doomgeneric_Create(int argc, char **argv)
{
    myargc = argc;
    myargv = argv;
    M_FindResponseFile();
    DG_ScreenBuffer = malloc(DOOMGENERIC_RESX * DOOMGENERIC_RESY * sizeof(pixel_t));
    DG_Init();
    D_DoomMain();
}

void DG_Init(void)
{
    fprintf(stderr, "[asym_view] headless DG_Init\n");
}

void DG_DrawFrame(void) {}

void DG_SleepMs(uint32_t ms)
{
    s_host_ms += (ms > 0) ? ms : 1;
}

uint32_t DG_GetTicksMs(void)
{
    return s_host_ms;
}

int DG_GetKey(int *pressed, unsigned char *key)
{
    (void)pressed;
    (void)key;
    return 0;
}

void DG_SetWindowTitle(const char *title)
{
    (void)title;
}

/* Expected by doomgeneric input path */
int api_get_input_event(int *pressed, unsigned char *key)
{
    (void)pressed;
    (void)key;
    return 0;
}

/* S_StartSound calls this for thin-client capture; viewer has no wire queue. */
void asym_notify_sound(void *origin_p, int sfx_id)
{
    (void)origin_p;
    (void)sfx_id;
}
