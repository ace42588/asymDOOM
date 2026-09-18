#ifndef DOOM_API_BRIDGE_H
#define DOOM_API_BRIDGE_H

#ifdef __cplusplus
extern "C" {
#endif

static inline int doom_bridge_get_doors_count(void) { return 0; }
static inline int doom_bridge_get_door_index_for_vldoor(void *vldoor) {
  (void)vldoor;
  return -1;
}
static inline int doom_bridge_door_allow(int door_index, int open_flag) {
  (void)door_index;
  (void)open_flag;
  return 1;
}
static inline int doom_bridge_eval_access(void *principal, void *asset, void *action) {
  (void)principal;
  (void)asset;
  (void)action;
  return 1;
}

#ifdef __cplusplus
}
#endif

#endif
