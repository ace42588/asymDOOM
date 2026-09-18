/* Print one snapshot as JSON for contracts validation. */
#include "asym_embed.h"
#include <stdio.h>
#include <stdlib.h>

int main(void)
{
    asym_config cfg = {0};
    asym_embed *e;
    asym_snapshot snap;
    int i;
    const char *wad = getenv("ASYM_WAD");
    if (!wad || !wad[0]) wad = "../assets/doom1.wad";
    cfg.iwad_path = wad;
    cfg.skill = 3;
    cfg.episode = 1;
    cfg.map = 1;
    cfg.marine_death = 0;
    cfg.possess_mask = 0xff;
    e = asym_create(&cfg);
    if (!e) {
        fprintf(stderr, "create failed\n");
        return 1;
    }
    for (i = 0; i < 35; i++) asym_tick(e);
    asym_get_snapshot(e, &snap);
    printf("{\n");
    printf("  \"type\": \"snapshot\",\n");
    printf("  \"protocolVersion\": 1,\n");
    printf("  \"tick\": %d,\n", snap.tick);
    printf("  \"serverTime\": 0,\n");
    printf("  \"mapName\": \"%s\",\n", snap.map_name);
    printf("  \"role\": \"spectator\",\n");
    printf("  \"controlledId\": null,\n");
    printf("  \"followTargetId\": null,\n");
    printf("  \"points\": 0,\n");
    printf("  \"mods\": {\"health\":0,\"speed\":0,\"damage\":0,\"rate\":0},\n");
    printf("  \"actors\": {\"spawn\":[");
    for (i = 0; i < snap.actor_count && i < 8; i++) {
        asym_actor *a = &snap.actors[i];
        if (i) printf(",");
        printf("{\"id\":%u,\"kind\":\"%s\",\"type\":%d,\"typeName\":\"%s\","
               "\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,\"angle\":%.3f,"
               "\"health\":%d,\"controllerSessionId\":null}",
               a->id, a->kind == 0 ? "marine" : "monster", a->type, a->type_name,
               a->x, a->y, a->z, a->angle, a->health);
    }
    printf("],\"update\":[],\"despawn\":[]},\n");
    printf("  \"projectiles\": {\"spawn\":[],\"update\":[],\"despawn\":[]},\n");
    printf("  \"doors\": {\"spawn\":[],\"update\":[],\"despawn\":[]},\n");
    printf("  \"events\": []\n");
    printf("}\n");
    asym_destroy(e);
    return 0;
}
