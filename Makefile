# PAO Console Dial — Multi-project Makefile
# Orchestrates three PlatformIO firmware projects and one React Native mobile app

.PHONY: help

# Default target
help: ## Show all available targets
	@echo "PAO Console Dial — Build & Deploy"
	@echo "=================================="
	@echo ""
	@grep -E '^\w+.*:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*##"}; {printf "  %-30s %s\n", $$1, $$2}'
	@echo ""

# ─────────────────────────────────────────────────────────────────────────
# Peripheral (ESP32-S3)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-peripheral upload-peripheral monitor-peripheral clean-peripheral

build-peripheral: ## Build peripheral firmware (ESP32-S3)
	cd peripheral && pio run

upload-peripheral: ## Upload peripheral firmware to device
	cd peripheral && pio run -t upload

monitor-peripheral: ## Open serial monitor for peripheral device
	cd peripheral && pio run -t monitor

clean-peripheral: ## Clean peripheral build artifacts
	cd peripheral && pio run -t clean

# ─────────────────────────────────────────────────────────────────────────
# Controller (SAMD21 Feather M0 Express)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-controller upload-controller monitor-controller clean-controller

build-controller: ## Build controller firmware (SAMD21)
	cd controller && pio run

upload-controller: ## Upload controller firmware to device
	cd controller && pio run -t upload

monitor-controller: ## Open serial monitor for controller device
	cd controller && pio run -t monitor

clean-controller: ## Clean controller build artifacts
	cd controller && pio run -t clean

# ─────────────────────────────────────────────────────────────────────────
# Charger (SAMD21 Feather M0)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build-charger upload-charger monitor-charger clean-charger release-charger-patch release-charger-minor release-charger-major release-dial-patch release-dial-minor release-dial-major release-controller-patch release-controller-minor release-controller-major

build-charger: ## Build charger firmware (ESP32 V2)
	cd charger && pio run

upload-charger: ## Upload charger firmware to device
	cd charger && pio run -t upload

monitor-charger: ## Open serial monitor for charger device
	cd charger && pio run -t monitor

clean-charger: ## Clean charger build artifacts
	cd charger && pio run -t clean

release-charger-patch: ## Bump charger patch version, tag, and push (auto-detects next version from charger-v* tags in submodule)
	@if ! git -C charger diff --quiet || ! git -C charger diff --cached --quiet; then \
		echo "❌ charger submodule working tree is dirty. Commit or stash changes inside charger/ before tagging a release."; \
		exit 1; \
	fi
	@echo "Fetching charger submodule origin..."; \
	git -C charger fetch origin >/dev/null 2>&1 || { echo "❌ Failed to fetch charger submodule origin."; exit 1; }; \
	if ! git -C charger merge-base --is-ancestor HEAD origin/main; then \
		echo "❌ Submodule HEAD is ahead of origin. cd charger && git push, then retry."; \
		exit 1; \
	fi
	@latest=$$(git -C charger tag -l 'charger-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.0.1"; \
	else \
		ver=$${latest#charger-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		patch=$$(echo $$ver | awk -F. '{print $$3}'); \
		next="$$major.$$minor.$$((patch + 1))"; \
	fi; \
	tag="charger-v$$next"; \
	if git -C charger rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists in submodule. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing charger v$$next..."; \
	git -C charger tag -a "$$tag" -m "Charger release v$$next" && \
	git -C charger push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag (in charger submodule)"

release-charger-minor: ## Bump charger minor version, tag, and push (auto-detects next version from charger-v* tags in submodule)
	@if ! git -C charger diff --quiet || ! git -C charger diff --cached --quiet; then \
		echo "❌ charger submodule working tree is dirty. Commit or stash changes inside charger/ before tagging a release."; \
		exit 1; \
	fi
	@echo "Fetching charger submodule origin..."; \
	git -C charger fetch origin >/dev/null 2>&1 || { echo "❌ Failed to fetch charger submodule origin."; exit 1; }; \
	if ! git -C charger merge-base --is-ancestor HEAD origin/main; then \
		echo "❌ Submodule HEAD is ahead of origin. cd charger && git push, then retry."; \
		exit 1; \
	fi
	@latest=$$(git -C charger tag -l 'charger-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.1.0"; \
	else \
		ver=$${latest#charger-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		next="$$major.$$((minor + 1)).0"; \
	fi; \
	tag="charger-v$$next"; \
	if git -C charger rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists in submodule. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing charger v$$next..."; \
	git -C charger tag -a "$$tag" -m "Charger release v$$next" && \
	git -C charger push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag (in charger submodule)"

release-charger-major: ## Bump charger major version, tag, and push (auto-detects next version from charger-v* tags in submodule)
	@if ! git -C charger diff --quiet || ! git -C charger diff --cached --quiet; then \
		echo "❌ charger submodule working tree is dirty. Commit or stash changes inside charger/ before tagging a release."; \
		exit 1; \
	fi
	@echo "Fetching charger submodule origin..."; \
	git -C charger fetch origin >/dev/null 2>&1 || { echo "❌ Failed to fetch charger submodule origin."; exit 1; }; \
	if ! git -C charger merge-base --is-ancestor HEAD origin/main; then \
		echo "❌ Submodule HEAD is ahead of origin. cd charger && git push, then retry."; \
		exit 1; \
	fi
	@latest=$$(git -C charger tag -l 'charger-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="1.0.0"; \
	else \
		ver=$${latest#charger-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		next="$$((major + 1)).0.0"; \
	fi; \
	tag="charger-v$$next"; \
	if git -C charger rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists in submodule. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing charger v$$next..."; \
	git -C charger tag -a "$$tag" -m "Charger release v$$next" && \
	git -C charger push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag (in charger submodule)"

# ─────────────────────────────────────────────────────────────────────────
# Dial (Peripheral — ESP32-S3)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: release-dial-patch release-dial-minor release-dial-major

release-dial-patch: ## Bump dial patch version, tag, and push (auto-detects next version from dial-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'dial-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.0.1"; \
	else \
		ver=$${latest#dial-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		patch=$$(echo $$ver | awk -F. '{print $$3}'); \
		next="$$major.$$minor.$$((patch + 1))"; \
	fi; \
	tag="dial-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing dial v$$next..."; \
	git tag -a "$$tag" -m "Dial release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-dial-minor: ## Bump dial minor version, tag, and push (auto-detects next version from dial-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'dial-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.1.0"; \
	else \
		ver=$${latest#dial-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		next="$$major.$$((minor + 1)).0"; \
	fi; \
	tag="dial-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing dial v$$next..."; \
	git tag -a "$$tag" -m "Dial release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-dial-major: ## Bump dial major version, tag, and push (auto-detects next version from dial-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'dial-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="1.0.0"; \
	else \
		ver=$${latest#dial-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		next="$$((major + 1)).0.0"; \
	fi; \
	tag="dial-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing dial v$$next..."; \
	git tag -a "$$tag" -m "Dial release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

# ─────────────────────────────────────────────────────────────────────────
# Controller (SAMD21)
# ─────────────────────────────────────────────────────────────────────────

.PHONY: release-controller-patch release-controller-minor release-controller-major

release-controller-patch: ## Bump controller patch version, tag, and push (auto-detects next version from controller-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'controller-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.0.1"; \
	else \
		ver=$${latest#controller-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		patch=$$(echo $$ver | awk -F. '{print $$3}'); \
		next="$$major.$$minor.$$((patch + 1))"; \
	fi; \
	tag="controller-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing controller v$$next..."; \
	git tag -a "$$tag" -m "Controller release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-controller-minor: ## Bump controller minor version, tag, and push (auto-detects next version from controller-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'controller-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.1.0"; \
	else \
		ver=$${latest#controller-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		next="$$major.$$((minor + 1)).0"; \
	fi; \
	tag="controller-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing controller v$$next..."; \
	git tag -a "$$tag" -m "Controller release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-controller-major: ## Bump controller major version, tag, and push (auto-detects next version from controller-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'controller-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="1.0.0"; \
	else \
		ver=$${latest#controller-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		next="$$((major + 1)).0.0"; \
	fi; \
	tag="controller-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing controller v$$next..."; \
	git tag -a "$$tag" -m "Controller release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

# ─────────────────────────────────────────────────────────────────────────
# Aggregate Firmware Targets
# ─────────────────────────────────────────────────────────────────────────

.PHONY: build clean

build: build-peripheral build-controller build-charger ## Build all three firmware projects

clean: clean-peripheral clean-controller clean-charger ## Clean all firmware projects

# ─────────────────────────────────────────────────────────────────────────
# Mobile (React Native)
# ─────────────────────────────────────────────────────────────────────────

JAVA_HOME_17 := /Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home
NODE_DIR     := $(shell dirname $(shell which node))

.PHONY: mobile-install mobile-android mobile-android-fresh mobile-android-release mobile-android-bundle mobile-ios mobile-start mobile-metro reset-android-cache release-mobile-patch release-mobile-minor release-mobile-major

mobile-install: ## Install mobile app dependencies (npm install)
	cd mobile && npm install

mobile-metro: ## Start Metro bundler in background (USB device workflow: run this first, then mobile-android)
	cd mobile && npx react-native start --reset-cache &

mobile-start: ## Start Metro bundler in foreground (run in a separate terminal)
	cd mobile && npx react-native start --reset-cache

mobile-android: ## Build and run mobile app on Android device (USB: sets adb reverse, requires Metro running)
	adb reverse tcp:8081 tcp:8081
	cd mobile && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" npx react-native run-android

mobile-android-fresh: ## Full USB Android workflow: adb reverse + Metro in background + build (single command)
	adb reverse tcp:8081 tcp:8081
	cd mobile && npx react-native start &
	sleep 8
	adb reverse tcp:8081 tcp:8081
	cd mobile && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" npx react-native run-android

mobile-android-release: ## Build release APK for sideloading (output: mobile/android/app/build/outputs/apk/release/)
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew assembleRelease
	@echo ""
	@apk=$$(find mobile/android/app/build/outputs/apk/release -name 'PaoConsole-*.apk' | head -1); \
	if [ -z "$$apk" ]; then echo "❌ No APK found"; exit 1; fi; \
	echo "✅ Release APK: $$apk"

mobile-android-release-install: ## Build release APK for sideloading (output: mobile/android/app/build/outputs/apk/release/)
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew assembleRelease
	@echo ""
	@apk=$$(find mobile/android/app/build/outputs/apk/release -name 'PaoConsole-*.apk' | head -1); \
	if [ -z "$$apk" ]; then echo "❌ No APK found"; exit 1; fi; \
	echo "✅ Release APK: $$apk"; \
	adb install -r "$$apk"

mobile-android-bundle: ## Build release AAB for Play Store (output: mobile/android/app/build/outputs/bundle/release/)
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew bundleRelease
	@echo ""
	@echo "✅ Release AAB: mobile/android/app/build/outputs/bundle/release/app-release.aab"

mobile-ios: ## Build and run mobile app on iOS
	cd mobile && npx react-native run-ios

reset-android-cache: ## Reset Android build cache
	cd mobile && cd android && JAVA_HOME=$(JAVA_HOME_17) ./gradlew clean

release-mobile-patch: ## Bump mobile patch version, tag, and push (auto-detects next version from mobile-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.0.1"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		patch=$$(echo $$ver | awk -F. '{print $$3}'); \
		next="$$major.$$minor.$$((patch + 1))"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-mobile-minor: ## Bump mobile minor version, tag, and push (auto-detects next version from mobile-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="0.1.0"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		minor=$$(echo $$ver | awk -F. '{print $$2}'); \
		next="$$major.$$((minor + 1)).0"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

release-mobile-major: ## Bump mobile major version, tag, and push (auto-detects next version from mobile-v* tags)
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "❌ Working tree is dirty. Commit or stash changes before tagging a release."; \
		exit 1; \
	fi
	@git fetch origin >/dev/null 2>&1 || true
	@if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then \
		echo "❌ HEAD is ahead of origin/main. Push your commits first."; \
		exit 1; \
	fi
	@latest=$$(git tag -l 'mobile-v*' | sort -V | tail -n 1); \
	if [ -z "$$latest" ]; then \
		next="1.0.0"; \
	else \
		ver=$${latest#mobile-v}; \
		major=$$(echo $$ver | awk -F. '{print $$1}'); \
		next="$$((major + 1)).0.0"; \
	fi; \
	tag="mobile-v$$next"; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null; then \
		echo "❌ Tag $$tag already exists. Aborting."; \
		exit 1; \
	fi; \
	echo "Releasing mobile v$$next..."; \
	git tag -a "$$tag" -m "Mobile release v$$next" && \
	git push origin "$$tag" && \
	echo "✅ Tagged and pushed $$tag"

# ─────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────

.PHONY: version

version: ## Show project version info
	@echo "PAO Console Dial — Multi-project Build System"
	@echo "Firmware sub-projects: peripheral (ESP32-S3), controller (SAMD21), charger (ESP32 V2)"
	@echo "Mobile app: React Native"
