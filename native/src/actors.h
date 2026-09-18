#ifndef ASYM_ACTORS_H
#define ASYM_ACTORS_H

#include <stdint.h>

struct mobj_s;

void asym_actors_reset(void);
void asym_actors_on_spawn(struct mobj_s *mo);
void asym_actors_on_remove(struct mobj_s *mo);
struct mobj_s *asym_actors_find(uint32_t id);
uint32_t asym_actors_count(void);
/* Enumerate living shootable monsters + player. Returns count written. */
int asym_actors_enumerate(struct mobj_s **out, int max_out);
uint32_t asym_actors_next_id(void);

#endif
