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

.PHONY: build-charger upload-charger monitor-charger clean-charger

build-charger: ## Build charger firmware (SAMD21)
	cd charger && pio run

upload-charger: ## Upload charger firmware to device
	cd charger && pio run -t upload

monitor-charger: ## Open serial monitor for charger device
	cd charger && pio run -t monitor

clean-charger: ## Clean charger build artifacts
	cd charger && pio run -t clean

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

.PHONY: mobile-install mobile-android mobile-android-fresh mobile-android-release mobile-android-bundle mobile-ios mobile-start mobile-metro reset-android-cache

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
	@echo "✅ Release APK: mobile/android/app/build/outputs/apk/release/PaoConsole-1.0.apk"

mobile-android-release-install: ## Build release APK for sideloading (output: mobile/android/app/build/outputs/apk/release/)
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew assembleRelease
	@echo ""
	@echo "✅ Release APK: mobile/android/app/build/outputs/apk/release/PaoConsole-1.0.apk"
	cd mobile/android/app/build/outputs/apk/release && adb install PaoConsole-1.0.apk

mobile-android-bundle: ## Build release AAB for Play Store (output: mobile/android/app/build/outputs/bundle/release/)
	cd mobile/android && JAVA_HOME=$(JAVA_HOME_17) PATH="$(NODE_DIR):$$PATH" ./gradlew bundleRelease
	@echo ""
	@echo "✅ Release AAB: mobile/android/app/build/outputs/bundle/release/app-release.aab"

mobile-ios: ## Build and run mobile app on iOS
	cd mobile && npx react-native run-ios

reset-android-cache: ## Reset Android build cache
	cd mobile && cd android && JAVA_HOME=$(JAVA_HOME_17) ./gradlew clean

# ─────────────────────────────────────────────────────────────────────────
# Utility
# ─────────────────────────────────────────────────────────────────────────

.PHONY: version

version: ## Show project version info
	@echo "PAO Console Dial — Multi-project Build System"
	@echo "Firmware sub-projects: peripheral (ESP32-S3), controller (SAMD21), charger (SAMD21)"
	@echo "Mobile app: React Native"
