# Builds ccdots.app: swift build, then the bundle around the binary. The bundle
# is committed, because launchd must not wait on a compiler at login.
APP   := ccdots.app
BIN   := .build/release/ccdots
EXE   := $(APP)/Contents/MacOS/ccdots
SRC   := $(wildcard Sources/ccdots/*.swift)
LABEL := dev.natten.ccdots
UID   := $(shell id -u)

.PHONY: all run load unload reload sign clean

all: $(EXE)

$(BIN): Package.swift $(SRC)
	swift build -c release

$(EXE): $(BIN) Info.plist
	mkdir -p $(APP)/Contents/MacOS
	cp Info.plist $(APP)/Contents/Info.plist
	printf 'APPL????' > $(APP)/Contents/PkgInfo
	cp $(BIN) $@

run: $(EXE)
	$(EXE)

load:
	launchctl bootstrap gui/$(UID) $(HOME)/Library/LaunchAgents/$(LABEL).plist

unload:
	-launchctl bootout gui/$(UID)/$(LABEL)

# The kernel kills a running process whose executable is rewritten underneath
# it, so the agent has to be down before the new binary lands
reload:
	$(MAKE) unload
	$(MAKE) all
	$(MAKE) load

sign:
	codesign --force --sign - $(APP)

clean:
	rm -rf .build $(APP)
