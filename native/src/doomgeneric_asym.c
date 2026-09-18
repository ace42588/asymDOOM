/*
 * doomgeneric_asym.c — Headless platform layer with host-driven timing.
 * Replaces doomgeneric_headless.c for asymDOOM (no wall-clock sleep).
 */
#include "doomkeys.h"
#include "m_argv.h"
#include "doomgeneric.h"

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

pixel_t *DG_ScreenBuffer = NULL;

static uint32_t s_host_ms = 0;

void asym_host_set_ticks_ms(uint32_t ms) { s_host_ms = ms; }
uint32_t asym_host_get_ticks_ms(void) { return s_host_ms; }
void asym_host_sleep_noop(uint32_t ms) { (void)ms; }

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
    fprintf(stderr, "[asym] headless DG_Init\n");
}

void DG_DrawFrame(void) {}

void DG_SleepMs(uint32_t ms)
{
    /* Advance host clock so TryRunTics wait-loops can exit without wall sleep. */
    s_host_ms += (ms > 0) ? ms : 1;
}

uint32_t DG_GetTicksMs(void)
{
    return s_host_ms;
}

int DG_GetKey(int *pressed, unsigned char *key)
{
    extern int api_get_input_event(int *pressed, unsigned char *key);
    return api_get_input_event(pressed, key);
}

void DG_SetWindowTitle(const char *title)
{
    (void)title;
}
