################################################################
# libasymdoom — headless shared library (adapted from doom-caep Makefile.shared)
################################################################

ifeq ($(V),1)
	VB=
else
	VB=@
endif

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Linux)
	SHARED_EXT = .so
	SHARED_FLAGS = -shared -fPIC
	EXPORT_FLAGS = -Wl,--export-dynamic
endif
ifeq ($(UNAME_S),Darwin)
	SHARED_EXT = .dylib
	SHARED_FLAGS = -dynamiclib -fPIC
	EXPORT_FLAGS = -Wl,-exported_symbols_list,exported_symbols.txt
endif

CC ?= clang
ROOT := $(abspath .)
ENG := $(ROOT)/engine
SRC := $(ROOT)/src
API := $(ROOT)/api
OBJDIR := $(ROOT)/build
OUTPUT := $(OBJDIR)/libasymdoom$(SHARED_EXT)

CFLAGS = -ggdb3 -Os -Wall -Wno-unused-parameter -Wno-unused-variable \
	-DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE -fPIC -DNO_SOUND \
	-I$(ENG) -I$(SRC) -I$(API) -I$(SRC)/events
LDFLAGS = $(SHARED_FLAGS)
LIBS = -lm -lc

# doomgeneric sources (headless via doomgeneric_asym.c, not doomgeneric_headless.c)
SRC_DOOM = dummy.o am_map.o doomdef.o doomstat.o dstrings.o d_event.o d_items.o \
	d_iwad.o d_loop.o d_main.o d_mode.o d_net.o f_finale.o f_wipe.o g_game.o \
	hu_lib.o hu_stuff.o info.o i_cdmus.o i_endoom.o i_joystick.o i_scale.o \
	i_sound.o i_system.o i_timer.o memio.o m_argv.o m_bbox.o m_cheat.o \
	m_config.o m_controls.o m_fixed.o m_menu.o m_misc.o m_random.o \
	p_ceilng.o p_doors.o p_enemy.o p_floor.o p_inter.o p_lights.o p_map.o \
	p_maputl.o p_mobj.o p_plats.o p_pspr.o p_saveg.o p_setup.o p_sight.o \
	p_spec.o p_switch.o p_telept.o p_tick.o p_user.o r_bsp.o r_data.o \
	r_draw.o r_main.o r_plane.o r_segs.o r_sky.o r_things.o sha1.o sounds.o \
	statdump.o st_lib.o st_stuff.o s_sound.o tables.o v_video.o wi_stuff.o \
	w_checksum.o w_file.o w_main.o w_wad.o z_zone.o w_file_stdc.o i_input.o \
	i_video.o

# Our bridge sources
SRC_ASYM = doomgeneric_asym.o actors.o control.o asym_rules.o asym_embed_impl.o asym_sound.o events.o

OBJS = $(addprefix $(OBJDIR)/,$(SRC_DOOM)) $(addprefix $(OBJDIR)/,$(SRC_ASYM))

.PHONY: all clean test smoke print

all: $(OUTPUT)

clean:
	rm -rf $(OBJDIR)
	rm -f exported_symbols.txt

exported_symbols.txt:
	@echo "_asym_create" > $@
	@echo "_asym_destroy" >> $@
	@echo "_asym_tick" >> $@
	@echo "_asym_register_session" >> $@
	@echo "_asym_unregister_session" >> $@
	@echo "_asym_submit_input" >> $@
	@echo "_asym_possess" >> $@
	@echo "_asym_release" >> $@
	@echo "_asym_get_snapshot" >> $@
	@echo "_asym_events_pull" >> $@
	@echo "_asym_role" >> $@
	@echo "_asym_body" >> $@
	@echo "_asym_points" >> $@
	@echo "_asym_mods_get" >> $@
	@echo "_asym_get_tick" >> $@
	@echo "_asym_debug_sim_get" >> $@
	@echo "_asym_sizeof_actor" >> $@
	@echo "_asym_sizeof_snapshot" >> $@
	@echo "_asym_sizeof_event" >> $@
	@echo "_asym_sizeof_debug_sim" >> $@
	@echo "_asym_test_start_sound" >> $@
	@echo "_doomgeneric_Create" >> $@
	@echo "_doomgeneric_Tick" >> $@

$(OUTPUT): $(OBJS) exported_symbols.txt | $(OBJDIR)
	@echo [Linking $@]
	$(VB)$(CC) $(CFLAGS) $(LDFLAGS) $(OBJS) -o $(OUTPUT) $(LIBS) $(EXPORT_FLAGS)
	@echo [Built: $(OUTPUT)]

$(OBJDIR):
	mkdir -p $(OBJDIR)

$(OBJDIR)/%.o: $(ENG)/%.c | $(OBJDIR)
	@echo [CC $<]
	$(VB)$(CC) $(CFLAGS) -c $< -o $@

$(OBJDIR)/%.o: $(SRC)/%.c | $(OBJDIR)
	@echo [CC $<]
	$(VB)$(CC) $(CFLAGS) -c $< -o $@

$(OBJDIR)/events.o: $(SRC)/events/events.c $(API)/asym_embed.h | $(OBJDIR)
	@echo [CC $<]
	$(VB)$(CC) $(CFLAGS) -c $< -o $@

# --- tests / smoke ---
WAD ?= $(ROOT)/../assets/doom1.wad

$(OBJDIR)/test_runner: tests/test_runner.c $(OUTPUT)
	$(CC) $(CFLAGS) -I$(API) -I$(SRC) tests/test_runner.c -o $@ \
		-L$(OBJDIR) -lasymdoom -Wl,-rpath,$(OBJDIR) $(LIBS)

$(OBJDIR)/asymdoom-sim-smoke: tools/asymdoom-sim-smoke.c $(OUTPUT)
	$(CC) $(CFLAGS) -I$(API) tools/asymdoom-sim-smoke.c -o $@ \
		-L$(OBJDIR) -lasymdoom -Wl,-rpath,$(OBJDIR) $(LIBS)

test: $(OBJDIR)/test_runner
	ASYM_WAD=$(WAD) $(OBJDIR)/test_runner

smoke: $(OBJDIR)/asymdoom-sim-smoke
	ASYM_WAD=$(WAD) $(OBJDIR)/asymdoom-sim-smoke

print:
	@echo OUTPUT=$(OUTPUT)
	@echo PLATFORM=$(UNAME_S)
