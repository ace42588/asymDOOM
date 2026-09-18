// Headless doomgeneric implementation for API-only use
// No rendering, no window - just game logic

#include "doomkeys.h"
#include "m_argv.h"
#include "doomgeneric.h"

#include <stdio.h>
#include <unistd.h>
#include <stdbool.h>
#include <time.h>
#include <stdlib.h>

pixel_t* DG_ScreenBuffer = NULL;

// Forward declarations
void M_FindResponseFile(void);
void D_DoomMain(void);

void doomgeneric_Create(int argc, char **argv)
{
    // Save arguments
    myargc = argc;
    myargv = argv;

    M_FindResponseFile();

    // Allocate screen buffer (required by doomgeneric but not used for rendering)
    DG_ScreenBuffer = malloc(DOOMGENERIC_RESX * DOOMGENERIC_RESY * sizeof(pixel_t));

    DG_Init();

    D_DoomMain();
}

void DG_Init()
{
    // No-op for headless mode
    printf("DOOM API Bridge: Headless mode initialized\n");
}

void DG_DrawFrame()
{
    // Framebuffer is already updated by DOOM engine in DG_ScreenBuffer
    // The api_get_framebuffer() function can access it directly
    // No additional action needed here - framebuffer is ready for streaming
}

void DG_SleepMs(uint32_t ms)
{
    usleep(ms * 1000);
}

uint32_t DG_GetTicksMs()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

int DG_GetKey(int* pressed, unsigned char* key)
{
    // Read from input queue populated by WebSocket client via Python API
    extern int api_get_input_event(int* pressed, unsigned char* key);
    return api_get_input_event(pressed, key);
}

void DG_SetWindowTitle(const char * title)
{
    // No-op for headless mode
    (void)title;
}
